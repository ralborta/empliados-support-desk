/**
 * Flujo determinístico ticket Odoo / derivación humana V2 — dry-run por defecto.
 */
import type { PilotConversationState } from "./conversation-state.js";
import type { TicketDraft } from "./ticket-types.js";
import {
  categoryLabel,
  inferTicketCategory,
  inferTicketPriority,
  looksLikeCancelTicket,
  looksLikeTicketIntent,
} from "./ticket-core.js";
import {
  looksLikeExplicitConfirm,
  looksLikeExplicitReject,
} from "./odometer-core.js";
import {
  looksLikeBriefConfirmation,
  looksLikeBriefRejection,
} from "./brief-replies.js";
import {
  buildTicketOperationRecord,
  createTicketOperationId,
  findTicketByConfirmMessageId,
  findTicketByMessageId,
  findTicketByPayloadHash,
  hashTicketPayload,
} from "./ticket-operation.js";
import { createOdooHelpdeskTicketDryRun } from "./odoo-ticket-client.js";
import { priorityLabel } from "./maintenance-core.js";

export type TicketTurnResult =
  | { kind: "none" }
  | { kind: "reply"; message: string; state: PilotConversationState };

export type TicketWriteDeps = {
  createTicket?: (input: {
    subject: string;
    description: string;
    companyName: string | null;
    customerPhone: string;
    priority: string;
    dryRun: boolean;
  }) => Promise<{
    ok: boolean;
    error?: string;
    ticketId?: number;
    ref?: string;
    odooPayload?: Record<string, unknown>;
  }>;
};

let testDeps: TicketWriteDeps | undefined;

export function setTicketWriteDepsForTests(deps: TicketWriteDeps | undefined): void {
  testDeps = deps;
}

function emptyDraft(category = inferTicketCategory("")): TicketDraft {
  return {
    category,
    unit: null,
    reason: null,
    priority: "NORMAL",
    step: "idle",
  };
}

function buildConfirmQuestion(draft: TicketDraft): string {
  return (
    `Voy a crear un ticket para ${categoryLabel(draft.category)}:\n` +
    `• Motivo: ${draft.reason}\n` +
    `• Prioridad: ${priorityLabel(draft.priority)}\n` +
    (draft.unit ? `• Unidad: ${draft.unit.label}\n` : "") +
    `\nSi está correcto, respondé CONFIRMO.`
  );
}

export function startTicketDraft(
  state: PilotConversationState,
  input: {
    category: TicketDraft["category"];
    reason: string;
    priority?: TicketDraft["priority"];
    unit?: TicketDraft["unit"];
    skipConfirm?: boolean;
  },
): TicketDraft {
  const draft: TicketDraft = {
    category: input.category,
    unit: input.unit ?? state.selectedUnit,
    reason: input.reason,
    priority: input.priority ?? inferTicketPriority(input.reason),
    step: input.skipConfirm ? "await_confirm" : "await_confirm",
  };
  state.ticketDraft = draft;
  state.activeTramite = "odoo_ticket";
  return draft;
}

async function executeTicket(
  state: PilotConversationState,
  draft: TicketDraft,
  messageId: string,
  env: NodeJS.ProcessEnv,
): Promise<TicketTurnResult> {
  if (!draft.reason?.trim()) {
    return { kind: "reply", message: "Necesito el motivo del ticket.", state };
  }

  const dupMsg = findTicketByMessageId(state.ticketOperations ?? {}, messageId);
  if (dupMsg) return { kind: "reply", message: "Este mensaje ya generó un ticket (idempotencia).", state };

  const payloadHash = hashTicketPayload({
    tenantId: state.tenantId,
    phone: state.phone,
    category: draft.category,
    reason: draft.reason,
    patente: draft.unit?.patente ?? null,
  });

  const dup = findTicketByPayloadHash(state.ticketOperations ?? {}, payloadHash);
  if (dup) return { kind: "reply", message: "Ese ticket ya fue procesado (idempotencia).", state };

  const dupConfirm = findTicketByConfirmMessageId(state.ticketOperations ?? {}, messageId);
  if (dupConfirm) return { kind: "reply", message: "Este CONFIRMO ya fue procesado.", state };

  const dryRun = env.ALLOW_EXTERNAL_MUTATIONS !== "true";
  const operationId = createTicketOperationId();
  const company = state.companyName ?? "tu empresa";
  const subject = `${categoryLabel(draft.category)} · ${draft.unit?.patente ?? state.phone}`;
  const description = [
    `Ticket desde piloto V2 / WhatsApp.`,
    `Categoría: ${categoryLabel(draft.category)}`,
    `Empresa: ${company}`,
    draft.unit ? `Unidad: ${draft.unit.label}` : "",
    `Motivo: ${draft.reason}`,
    `Prioridad: ${priorityLabel(draft.priority)}`,
    `Teléfono: ${state.phone}`,
    `operationId: ${operationId}`,
    `messageId: ${messageId}`,
  ]
    .filter(Boolean)
    .join("\n");

  let result: {
    ok: boolean;
    error?: string;
    ticketId?: number;
    ref?: string;
    odooPayload?: Record<string, unknown>;
  };

  if (testDeps?.createTicket) {
    const r = await testDeps.createTicket({
      subject,
      description,
      companyName: state.companyName,
      customerPhone: state.phone,
      priority: draft.priority,
      dryRun,
    });
    result = r;
  } else {
    const odoo = await createOdooHelpdeskTicketDryRun(
      {
        subject,
        description,
        customerPhone: state.phone,
        companyName: company,
        priority: draft.priority,
        category: draft.category,
        dedupeKey: `v2_ticket:${draft.category}:${payloadHash.slice(0, 16)}`,
      },
      env,
    );
    result = odoo.ok
      ? {
          ok: true,
          ticketId: odoo.dryRun ? odoo.simulatedTicketId : odoo.ticketId,
          ref: odoo.dryRun ? odoo.simulatedRef : (odoo.ref ?? undefined),
          odooPayload: odoo.payload as unknown as Record<string, unknown>,
        }
      : { ok: false, error: odoo.error, odooPayload: odoo.payload as unknown as Record<string, unknown> };
  }

  const record = buildTicketOperationRecord({
    operationId,
    messageId,
    tenantId: state.tenantId,
    phone: state.phone,
    companyName: state.companyName,
    unit: draft.unit,
    category: draft.category,
    reason: draft.reason,
    priority: draft.priority,
    stateVersion: state.stateVersion,
    status: result.ok ? (dryRun ? "dry_run" : "written") : "failed",
    confirmMessageId: messageId,
    odooPayload: result.odooPayload ?? null,
    odooTicketId: result.ticketId ?? null,
    odooTicketRef: result.ref ?? null,
    resultSummary: result.ok ? (result.ref ?? "simulated") : (result.error ?? null),
  });

  if (!state.ticketOperations) state.ticketOperations = {};
  state.ticketOperations[operationId] = record;
  state.ticketDraft = null;
  state.pendingConfirmation = null;
  state.activeTramite = "none";
  state.step = "idle";

  if (!result.ok) {
    return { kind: "reply", message: result.error ?? "No se pudo crear el ticket.", state };
  }

  return {
    kind: "reply",
    message: dryRun
      ? `[Lab] Ticket Odoo simulado OK — ref ${result.ref ?? "DRY"}. Sin ticket real.`
      : `Ticket creado: ${result.ref ?? result.ticketId}.`,
    state,
  };
}

export async function tryResolveTicketTurn(input: {
  state: PilotConversationState;
  text: string;
  messageId: string;
  env: NodeJS.ProcessEnv;
}): Promise<TicketTurnResult> {
  const { state, text, messageId, env } = input;
  const activeTicket =
    state.activeTramite === "odoo_ticket" ||
    (state.ticketDraft && state.ticketDraft.step !== "idle") ||
    state.pendingConfirmation?.action === "odoo_ticket_create";

  if (!activeTicket && !looksLikeTicketIntent(text)) return { kind: "none" };

  if (!state.ticketDraft) {
    state.ticketDraft = emptyDraft(inferTicketCategory(text));
  }
  if (!state.ticketOperations) state.ticketOperations = {};
  const draft = state.ticketDraft;

  if (looksLikeCancelTicket(text)) {
    state.ticketDraft = emptyDraft();
    state.pendingConfirmation = null;
    state.activeTramite = "none";
    return { kind: "reply", message: "Cancelé la derivación.", state };
  }

  if (state.pendingConfirmation?.action === "odoo_ticket_create") {
    if (looksLikeExplicitReject(text) || looksLikeBriefRejection(text)) {
      state.pendingConfirmation = null;
      draft.step = "await_reason";
      return { kind: "reply", message: "Ok, no creo el ticket. Decime el motivo correcto.", state };
    }
    if (looksLikeExplicitConfirm(text) || looksLikeBriefConfirmation(text)) {
      return executeTicket(state, draft, messageId, env);
    }
    if (text.trim().length >= 6) {
      draft.reason = text.trim();
      draft.priority = inferTicketPriority(text);
      const q = buildConfirmQuestion(draft);
      state.pendingConfirmation = {
        action: "odoo_ticket_create",
        unit: draft.unit ?? state.selectedUnit ?? { patente: "—", label: "—", unidad: "—", movil_id: 0 },
        askedAt: new Date().toISOString(),
        question: q,
        operationId: state.pendingConfirmation.operationId,
      };
      return { kind: "reply", message: q, state };
    }
  }

  if (draft.step === "idle") {
    state.activeTramite = "odoo_ticket";
    draft.category = inferTicketCategory(text, draft.category);
    draft.priority = inferTicketPriority(text);
    draft.unit = state.selectedUnit;
    if (looksLikeTicketIntent(text) && text.trim().length >= 12) {
      draft.reason = text.trim();
      draft.step = "await_confirm";
    } else {
      draft.step = "await_reason";
      return {
        kind: "reply",
        message: "Contame brevemente el motivo para derivarte a un operador.",
        state,
      };
    }
  }

  if (draft.step === "await_reason") {
    if (text.trim().length < 6) {
      return { kind: "reply", message: "Necesito un motivo un poco más específico.", state };
    }
    draft.reason = text.trim();
    draft.priority = inferTicketPriority(text);
    draft.step = "await_confirm";
  }

  if (draft.step === "await_confirm" && draft.reason) {
    const q = buildConfirmQuestion(draft);
    state.pendingConfirmation = {
      action: "odoo_ticket_create",
      unit: draft.unit ?? state.selectedUnit ?? { patente: "—", label: "—", unidad: "—", movil_id: 0 },
      askedAt: new Date().toISOString(),
      question: q,
      operationId: createTicketOperationId(),
    };
    if (looksLikeExplicitConfirm(text) || looksLikeBriefConfirmation(text)) {
      return executeTicket(state, draft, messageId, env);
    }
    return { kind: "reply", message: q, state };
  }

  return { kind: "none" };
}

/** Derivación automática tras fallo WARA (sin confirmación adicional). */
export async function escalateToTicket(input: {
  state: PilotConversationState;
  messageId: string;
  env: NodeJS.ProcessEnv;
  category: TicketDraft["category"];
  reason: string;
}): Promise<TicketTurnResult> {
  const draft = startTicketDraft(input.state, {
    category: input.category,
    reason: input.reason,
    unit: input.state.selectedUnit,
    skipConfirm: true,
  });
  draft.step = "await_confirm";
  return executeTicket(input.state, draft, input.messageId, input.env);
}
