/**
 * Puente hacia tickets locales V1 LAB (front-v2-lab) — solo DB aislada.
 */
import { postV2BridgeTicket } from "./v1-bridge-client.js";

export type V1LocalTicketInput = {
  phoneE164: string;
  tenantId: string;
  contactName: string;
  companyName?: string | null;
  title: string;
  messageText: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  category?: "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER";
  operationId: string;
  payloadHash: string;
  tramite: string;
  operationStatus: string;
  externalResult?: string | null;
  unknownOutcome?: boolean;
  reconciliationRequired?: boolean;
  collectedData?: Record<string, unknown>;
  derivationReason?: string | null;
  unit?: { patente?: string; label?: string } | null;
};

export type V1LocalTicketResult =
  | { ok: true; ticketId: string; ticketCode: string; created: boolean; autoAssigned: boolean }
  | { ok: false; error: string; skipped?: boolean };

function isBridgeEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.WARA_V2_V1_TICKET_BRIDGE_ENABLED === "true" &&
    env.WARA_V2_LAB_MODE === "true"
  );
}

function isPhoneAllowlisted(phone: string, env: NodeJS.ProcessEnv): boolean {
  const raw = (env.WARA_V2_BRIDGE_PHONE_ALLOWLIST ?? env.WARA_V2_SHADOW_ALLOWLIST ?? "").trim();
  if (!raw) return false;
  const list = raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const norm = phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`;
  return list.includes(norm);
}

function isTenantAllowlisted(tenantId: string, env: NodeJS.ProcessEnv): boolean {
  const allowed = (env.WARA_V2_BRIDGE_TENANT_ALLOWLIST ?? env.WARA_V2_SHADOW_TENANT ?? "tenant_internal_ops").trim();
  return tenantId === allowed || allowed.split(",").map((t) => t.trim()).includes(tenantId);
}

export async function createV1LocalTicketIfEnabled(
  input: V1LocalTicketInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<V1LocalTicketResult> {
  if (!isBridgeEnabled(env)) {
    return { ok: false, error: "WARA_V2_V1_TICKET_BRIDGE_ENABLED=false o lab off", skipped: true };
  }
  if (!isTenantAllowlisted(input.tenantId, env)) {
    return { ok: false, error: "tenant_not_allowlisted", skipped: true };
  }
  if (!isPhoneAllowlisted(input.phoneE164, env)) {
    return { ok: false, error: "phone_not_allowlisted", skipped: true };
  }

  return postV2BridgeTicket(input, env);
}
