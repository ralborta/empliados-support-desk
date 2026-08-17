import type { CleanRuntimeConfig } from "../../config/clean-config.js";
import { V1LeastLoadAssignmentStrategy, type AdvisorCandidate, type AssignmentRequest, type AssignmentSelection } from "../../core/assignment/assignment-strategy.js";
import type { CommitBinding, ConversationDestination, ConversationOperationData, TicketOperationData } from "./operational-service-contracts.js";
import { GuardedHttpTransport, type SingleRequestTransport, type TenantPermission } from "./guarded-http-transport.js";
import type { NormalizedServiceResult } from "./normalized-service-result.js";

type WriteContext = Readonly<{ tenant: TenantPermission; correlationId: string; authorized: boolean; binding: CommitBinding; pendingBinding?: CommitBinding }>;
type TicketAction = "create" | "update" | "close" | "reopen";
const TERMINAL = new Set(["closed", "resolved"]);

export class GuardedOdooHandoffAdapter {
  private readonly http: GuardedHttpTransport;
  constructor(config: CleanRuntimeConfig, transport: SingleRequestTransport) { this.http = new GuardedHttpTransport(config, transport); }

  ticketStatus(input: Readonly<{ tenant: TenantPermission; correlationId: string; authorized: boolean; ticketId: string }>): Promise<NormalizedServiceResult<TicketOperationData>> {
    return this.http.execute({ ...input, capability: "ticket.get_status", kind: "read", path: "/odoo/helpdesk/status", body: { ticketId: input.ticketId } });
  }
  ticketWrite(input: WriteContext & Readonly<{ action: TicketAction; ticketId?: string; subject?: string; detail?: string; currentStatus?: string; idempotencyKey: string }>): Promise<NormalizedServiceResult<TicketOperationData>> {
    if (input.action === "create" && (!input.subject?.trim() || !input.detail?.trim())) return Promise.resolve({ status: "validation_error", errors: ["subject_and_detail_required"] });
    if (input.action !== "create" && !input.ticketId) return Promise.resolve({ status: "validation_error", errors: ["ticket_id_required"] });
    if (input.action === "reopen" && input.currentStatus && !TERMINAL.has(input.currentStatus)) return Promise.resolve({ status: "conflict", code: "ticket_not_terminal", facts: [] });
    return this.http.execute({ ...input, capability: `ticket.${input.action}.commit`, kind: "write", path: `/odoo/helpdesk/${input.action}`, body: { ticketId: input.ticketId, subject: input.subject, detail: input.detail, idempotencyKey: input.idempotencyKey } });
  }
  conversationWrite(input: WriteContext & Readonly<{ action: "handoff" | "assign" | "release"; conversationId: string; destination?: ConversationDestination; reason?: string }>): Promise<NormalizedServiceResult<ConversationOperationData>> {
    if (input.action !== "release" && (!input.destination?.id || !["agent", "team", "queue"].includes(input.destination.type))) return Promise.resolve({ status: "validation_error", errors: ["valid_destination_required"] });
    return this.http.execute({ ...input, capability: `conversation.${input.action}.commit`, kind: "write", path: `/conversations/${input.action}`, body: { conversationId: input.conversationId, destination: input.destination, reason: input.reason } });
  }
  presence(input: Readonly<{ tenant: TenantPermission; correlationId: string; authorized: boolean; teamId: string }>): Promise<NormalizedServiceResult<readonly AdvisorCandidate[]>> {
    return this.http.execute({ ...input, capability: "assignment.presence", kind: "read", path: "/assignment/presence", body: { teamId: input.teamId } });
  }
  chooseAssignment(request: AssignmentRequest, candidates: readonly AdvisorCandidate[]): AssignmentSelection { return new V1LeastLoadAssignmentStrategy().select(request, candidates); }
}
