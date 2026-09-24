/**
 * Evaluation-only — imposible combinar con entrega / DeliveryGate / outbox.
 */
import { FakeModelAdapter } from "@wara-v2/orchestrator";
import { parseOrchestratorDecision } from "@wara-v2/contracts";
import type { DeidMessage } from "./deid.js";
import { loadApprovedDataset } from "./pipeline.js";

export type EvalOnlyFlags = {
  EVALUATION_ONLY: true;
  DELIVERY_ENABLED: false;
  ALLOW_EXTERNAL_MUTATIONS: false;
  REAL_CHANNELS_ENABLED: false;
};

export function loadEvalOnlyFlags(
  env: NodeJS.ProcessEnv = process.env,
): EvalOnlyFlags {
  if (env.EVALUATION_ONLY !== "true" && env.EVALUATION_ONLY !== "1") {
    throw new Error("evaluation_only_required");
  }
  if (env.DELIVERY_ENABLED === "true" || env.DELIVERY_ENABLED === "1") {
    throw new Error("evaluation_only_incompatible_with_delivery");
  }
  if (env.ALLOW_EXTERNAL_MUTATIONS === "true") {
    throw new Error("evaluation_only_incompatible_with_mutations");
  }
  if (env.REAL_CHANNELS_ENABLED === "true") {
    throw new Error("evaluation_only_incompatible_with_channels");
  }
  return {
    EVALUATION_ONLY: true,
    DELIVERY_ENABLED: false,
    ALLOW_EXTERNAL_MUTATIONS: false,
    REAL_CHANNELS_ENABLED: false,
  };
}

export type OfflineEvalCase = {
  golden_expected?: { intent?: string; must_clarify?: boolean };
  llm_proposal?: unknown;
  policy_decision?: { blockReasons: string[] };
  hypothetical_transition?: string;
  simulated_reply?: string;
  intent_match?: boolean | null;
  clarify_expected?: boolean;
  effects_created: {
    operations: 0;
    attempts: 0;
    outbox: 0;
    deliveries: 0;
  };
};

export type OfflineEvalSummary = {
  cases: number;
  intent_accuracy: number | null;
  clarify_cases: number;
  policy_rejects: number;
  effects: { operations: 0; attempts: 0; outbox: 0; deliveries: 0 };
};

/**
 * Evalúa mensajes aprobados con FakeModel (sin DeliveryGate / dispatcher).
 * Un segmento mínimo por request (una conversación a la vez).
 */
export async function evaluateApprovedOffline(
  datasetId: string,
  messages: DeidMessage[],
): Promise<{
  cases: OfflineEvalCase[];
  flags: EvalOnlyFlags;
  summary: OfflineEvalSummary;
}> {
  const flags = loadEvalOnlyFlags({
    EVALUATION_ONLY: "true",
    DELIVERY_ENABLED: "false",
    ALLOW_EXTERNAL_MUTATIONS: "false",
    REAL_CHANNELS_ENABLED: "false",
  });
  loadApprovedDataset(datasetId); // valida approved/expiry/revoke

  const byConv = new Map<string, DeidMessage[]>();
  for (const m of messages) {
    const arr = byConv.get(m.conversation_id) ?? [];
    arr.push(m);
    byConv.set(m.conversation_id, arr);
  }

  const model = new FakeModelAdapter();
  const cases: OfflineEvalCase[] = [];
  let intentHits = 0;
  let intentTotal = 0;
  let clarifyCases = 0;
  let policyRejects = 0;
  for (const [, turns] of byConv) {
    // segmento mínimo: último turn de usuario
    const lastUser = [...turns].reverse().find((t) => t.message_role === "user");
    if (!lastUser) continue;
    const golden = (lastUser as DeidMessage & {
      golden_expected?: { intent?: string; must_clarify?: boolean };
    }).golden_expected;
    // No cruzar tenants: un solo tenant_id por conversación ya garantizado
    const decision = await model.decide({
      conversation: {
        conversationId: lastUser.conversation_id,
        customerId: "eval_only",
        activeCompanyId: lastUser.tenant_id,
        activeUnitId: null,
        channel: "shadow",
        channelAccountId: "eval_only",
        membershipCompanyIds: [lastUser.tenant_id],
      },
      inbound: {
        messageId: `eval_${lastUser.conversation_id}_${lastUser.turn_index}`,
        provider: "synthetic",
        channelAccountId: "eval_only",
        conversationKey: lastUser.conversation_id,
        channel: "shadow",
        customerPhoneE164: "+5491100000000",
        text: lastUser.text,
        receivedAt: lastUser.received_at ?? new Date().toISOString(),
        payloadHash: "d".repeat(64),
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
    });
    const parsed = parseOrchestratorDecision(decision);
    const goal = parsed.ok ? parsed.data.proposedGoal : undefined;
    let intent_match: boolean | null = null;
    if (golden?.intent) {
      intentTotal += 1;
      intent_match = goal === golden.intent;
      if (intent_match) intentHits += 1;
    }
    if (golden?.must_clarify) {
      clarifyCases += 1;
      if (goal !== "clarify" && goal !== "none") {
        // FakeModel puede no aclarar; se registra, no falla el pipeline
      }
    }
    if (!parsed.ok) policyRejects += 1;
    cases.push({
      golden_expected: golden,
      llm_proposal: parsed.ok ? { goal } : { invalid: true },
      policy_decision: { blockReasons: parsed.ok ? [] : ["parse_failed"] },
      hypothetical_transition: "none_evaluation_only",
      simulated_reply: parsed.ok
        ? parsed.data.interpretationSummary.slice(0, 200)
        : undefined,
      intent_match,
      clarify_expected: Boolean(golden?.must_clarify),
      effects_created: {
        operations: 0,
        attempts: 0,
        outbox: 0,
        deliveries: 0,
      },
    });
  }
  void flags;
  return {
    cases,
    flags,
    summary: {
      cases: cases.length,
      intent_accuracy: intentTotal ? intentHits / intentTotal : null,
      clarify_cases: clarifyCases,
      policy_rejects: policyRejects,
      effects: { operations: 0, attempts: 0, outbox: 0, deliveries: 0 },
    },
  };
}
