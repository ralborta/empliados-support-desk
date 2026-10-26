/**
 * Shadow mode — observacional, sin entrega, sin destinos reales.
 */
import type { V2Runtime } from "../runtime/compose.js";
import type { LocalObserver } from "./observe.js";
import type { Phase7Flags } from "./flags.js";
import { randomUUID } from "node:crypto";

/** E164 sintético numérico aislado por tenant (sin datos reales). */
export function syntheticTenantPhone(tenantId: string): string {
  let h = 0;
  for (let i = 0; i < tenantId.length; i++) {
    h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
  }
  return `+54911${String(h % 1e8).padStart(8, "0")}`;
}

export type ShadowResult = {
  shadow: true;
  delivery_enabled: false;
  turn_id: string | null;
  outcome: string;
  operation_ids: string[];
  compared?: { match: boolean; note: string };
};

export async function processShadowIngress(
  runtime: V2Runtime,
  flags: Phase7Flags,
  observer: LocalObserver,
  input: {
    tenantId: string;
    text: string;
    externalMessageId: string;
    correlationId: string;
    expectedOutcome?: string;
  },
): Promise<ShadowResult> {
  if (!flags.SHADOW_MODE || flags.DELIVERY_ENABLED !== false) {
    throw new Error("shadow_flags_invalid");
  }
  const phone = syntheticTenantPhone(input.tenantId);
  const { customerId, conversationId } = await runtime.ensureConversation({
    phoneE164: phone,
    companyId: input.tenantId,
  });
  const started = Date.now();
  const result = await runtime.handleInbound({
    conversationId,
    customerId,
    companyId: input.tenantId,
    text: input.text,
    messageId: `${input.tenantId}::${input.externalMessageId}`,
    commandId: input.correlationId || randomUUID(),
  });
  observer.emit({
    at: new Date().toISOString(),
    event: "shadow_processed",
    tenant_id: input.tenantId,
    correlation_id: input.correlationId,
    duration_ms: Date.now() - started,
    reason_code: result.outcome,
    refs: { turn_id: result.turnId },
  });
  // Nunca entrega: no WhatsApp, no BBC, DELIVERY_ENABLED=false
  const compared =
    input.expectedOutcome != null
      ? {
          match: result.outcome === input.expectedOutcome,
          note: `expected=${input.expectedOutcome};actual=${result.outcome}`,
        }
      : undefined;
  return {
    shadow: true,
    delivery_enabled: false,
    turn_id: result.turnId,
    outcome: result.outcome,
    operation_ids: result.operationIds,
    compared,
  };
}
