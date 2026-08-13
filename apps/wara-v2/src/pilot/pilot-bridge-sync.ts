/**
 * Sincroniza operación V2 completada → ticket mesa lab vía bridge HTTP.
 */
import type { PilotConversationState } from "./conversation-state.js";
import { createV1LocalTicketIfEnabled } from "./v1-local-ticket-bridge.js";

export async function invokeLabTicketBridge(input: {
  state: PilotConversationState;
  operationId: string;
  payloadHash: string;
  tramite: string;
  operationStatus: string;
  title: string;
  messageText: string;
  derivationReason?: string | null;
  externalResult?: string | null;
  unknownOutcome?: boolean;
  collectedData?: Record<string, unknown>;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const env = input.env ?? process.env;
  const result = await createV1LocalTicketIfEnabled(
    {
      phoneE164: input.state.phone,
      tenantId: input.state.tenantId,
      contactName: input.state.customerName ?? input.state.companyName ?? "Cliente",
      companyName: input.state.companyName,
      title: input.title,
      messageText: input.messageText,
      priority: input.priority ?? "NORMAL",
      category: "TECH_SUPPORT",
      operationId: input.operationId,
      payloadHash: input.payloadHash,
      tramite: input.tramite,
      operationStatus: input.operationStatus,
      externalResult: input.externalResult ?? null,
      unknownOutcome: input.unknownOutcome ?? false,
      reconciliationRequired: input.unknownOutcome ?? false,
      collectedData: input.collectedData ?? {},
      derivationReason: input.derivationReason ?? null,
      unit: input.state.selectedUnit
        ? { patente: input.state.selectedUnit.patente, label: input.state.selectedUnit.label }
        : null,
    },
    env,
  );
  if (!result.ok && !result.skipped) {
    console.warn("[lab-ticket-bridge]", input.operationId, result.error);
  } else if (!result.ok && result.skipped) {
    console.warn("[lab-ticket-bridge] skipped", input.operationId, result.error);
  }
}
