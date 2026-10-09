/**
 * Replay determinístico de fixtures sintéticos (sin datos reales).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  parseCanonicalIngress,
  type CanonicalIngress,
} from "@wara-v2/contracts";
import type { V2Runtime } from "../runtime/compose.js";

export type ReplayStep = {
  at_offset_ms: number;
  ingress: Omit<
    CanonicalIngress,
    "correlation_id" | "received_at" | "is_replay"
  > & {
    correlation_id?: string;
    received_at?: string;
  };
};

export type ReplayFixture = {
  fixture_id: string;
  schema_version: 1;
  tenant_id: string;
  steps: ReplayStep[];
  expect?: {
    final_operation_status?: string;
    min_turns?: number;
  };
};

export type ReplayReport = {
  fixture_id: string;
  tenant_id: string;
  ok: boolean;
  steps: Array<{
    index: number;
    external_message_id: string;
    outcome: string;
    turn_id?: string;
  }>;
  errors: string[];
  deterministic_hash: string;
};

export type Clock = { now: () => Date };

export function fixedClock(start: Date): Clock & { advance: (ms: number) => void } {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export async function runReplay(
  runtime: V2Runtime,
  fixture: ReplayFixture,
  clock: Clock & { advance?: (ms: number) => void },
): Promise<ReplayReport> {
  const errors: string[] = [];
  const stepsOut: ReplayReport["steps"] = [];
  // Conversación descartable por corrida (determinismo entre runs independientes)
  const runSalt = randomUUID().replace(/-/g, "").slice(0, 8);
  const phone = `+54911${runSalt}`;
  const { customerId, conversationId } = await runtime.ensureConversation({
    phoneE164: phone,
    companyId: fixture.tenant_id,
  });

  for (let i = 0; i < fixture.steps.length; i++) {
    const step = fixture.steps[i]!;
    if (clock.advance) clock.advance(step.at_offset_ms);
    const received_at = step.ingress.received_at ?? clock.now().toISOString();
    const raw = {
      ...step.ingress,
      tenant_id: fixture.tenant_id,
      schema_version: 1 as const,
      is_replay: true,
      is_shadow: false,
      correlation_id: step.ingress.correlation_id ?? randomUUID(),
      received_at,
      metadata: {
        ...(step.ingress.metadata ?? {}),
        fixture_id: fixture.fixture_id,
        replay_step: String(i),
      },
    };
    let ingress: CanonicalIngress;
    try {
      ingress = parseCanonicalIngress(raw);
    } catch (e) {
      errors.push(`step_${i}:parse:${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const result = await runtime.handleInbound({
      conversationId,
      customerId,
      companyId: fixture.tenant_id,
      text: ingress.content.text,
      messageId: `${fixture.tenant_id}::${fixture.fixture_id}::${runSalt}::${ingress.external_message_id}`,
      commandId: ingress.correlation_id,
    });
    stepsOut.push({
      index: i,
      external_message_id: ingress.external_message_id,
      outcome: result.outcome,
      turn_id: result.turnId,
    });
  }

  if (fixture.expect?.min_turns != null) {
    const turns = await runtime.prisma.turn.count({
      where: { conversationId },
    });
    if (turns < fixture.expect.min_turns) {
      errors.push(`min_turns:${turns}<${fixture.expect.min_turns}`);
    }
  }

  const deterministic_hash = createHash("sha256")
    .update(
      JSON.stringify(
        stepsOut.map((s) => ({
          index: s.index,
          external_message_id: s.external_message_id,
          outcome: s.outcome,
        })),
      ),
    )
    .digest("hex");

  return {
    fixture_id: fixture.fixture_id,
    tenant_id: fixture.tenant_id,
    ok: errors.length === 0,
    steps: stepsOut,
    errors,
    deterministic_hash,
  };
}
