/**
 * Evaluación shadow 10A — solo ModelAdapter.decide + parse.
 * Cero DeliveryGate, dispatcher, ops, outbox, WhatsApp.
 */
import { FakeModelAdapter } from "@wara-v2/orchestrator";
import { parseOrchestratorDecision } from "@wara-v2/contracts";
import type { DeidMessage } from "../governance/deid.js";
import { withTimeout } from "./limits.js";

export type ShadowEvalResult = {
  intent?: string;
  missing_fields: string[];
  clarify?: string;
  hypothetical_transition: string;
  hypothetical_reply?: string;
  policy: { blockReasons: string[] };
  latency_ms: number;
  tokens_est: number;
  cost_usd_est: number;
  effects: {
    operations: 0;
    attempts: 0;
    outbox: 0;
    deliveries: 0;
    whatsapp_sends: 0;
  };
  error?: string;
};

const ZERO_EFFECTS = {
  operations: 0 as const,
  attempts: 0 as const,
  outbox: 0 as const,
  deliveries: 0 as const,
  whatsapp_sends: 0 as const,
};

export async function evaluateShadowSegment(
  deid: DeidMessage,
  opts: { timeout_ms: number },
): Promise<ShadowEvalResult> {
  const started = Date.now();
  const model = new FakeModelAdapter();
  try {
    const decision = await withTimeout(
      model.decide({
        conversation: {
          conversationId: deid.conversation_id,
          customerId: "shadow_canary",
          activeCompanyId: deid.tenant_id,
          activeUnitId: null,
          channel: "shadow",
          channelAccountId: "shadow_canary",
          membershipCompanyIds: [deid.tenant_id],
        },
        inbound: {
          messageId: `shadow_${deid.conversation_id}_${deid.turn_index}`,
          provider: "shadow_canary",
          channelAccountId: "shadow_canary",
          conversationKey: deid.conversation_id,
          channel: "shadow",
          customerPhoneE164: "+5491100000000",
          text: deid.text,
          receivedAt: deid.received_at ?? new Date().toISOString(),
          payloadHash: "e".repeat(64),
        },
        activeOperations: [],
        pendingConfirmationOperationId: null,
        stateVersion: 1,
        executionMode: "shadow",
        featureFlags: {
          enabled: true,
          allowedGoals: [
            "none",
            "clarify",
            "list_capabilities",
            "resolve_units",
            "unit_status",
            "update_odometer",
            "issue_certificate",
            "create_maintenance",
            "odoo_ticket",
            "human_handoff",
            "bot_pause",
          ],
          allowWhatsAppSend: false,
          allowWaraMutations: false,
          allowOdooMutations: false,
        },
        now: new Date(),
      }),
      opts.timeout_ms,
    );
    const parsed = parseOrchestratorDecision(decision);
    const latency_ms = Date.now() - started;
    if (!parsed.ok) {
      return {
        missing_fields: [],
        hypothetical_transition: "none",
        policy: { blockReasons: ["parse_failed"] },
        latency_ms,
        tokens_est: 0,
        cost_usd_est: 0,
        effects: { ...ZERO_EFFECTS },
        error: "parse_failed",
      };
    }
    const goal = parsed.data.proposedGoal;
    return {
      intent: goal,
      missing_fields: [],
      clarify: goal === "clarify" ? parsed.data.interpretationSummary.slice(0, 200) : undefined,
      hypothetical_transition: "none_evaluation_only",
      hypothetical_reply: parsed.data.interpretationSummary.slice(0, 400),
      policy: { blockReasons: [] },
      latency_ms,
      tokens_est: 0,
      cost_usd_est: 0,
      effects: { ...ZERO_EFFECTS },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return {
      missing_fields: [],
      hypothetical_transition: "none",
      policy: { blockReasons: ["eval_error"] },
      latency_ms: Date.now() - started,
      tokens_est: 0,
      cost_usd_est: 0,
      effects: { ...ZERO_EFFECTS },
      error: msg.slice(0, 120),
    };
  }
}
