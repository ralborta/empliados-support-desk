function isTruthy(v: string | undefined): boolean {
  const t = (v ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "si";
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

function parsePhoneAllowlist(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "*") return [];
  return trimmed
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter((p) => E164_RE.test(p));
}

export function isV2LabMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.WARA_V2_LAB_MODE);
}

export function isV2BridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.WARA_V2_V1_TICKET_BRIDGE_ENABLED) && isV2LabMode(env);
}

export function assertV2BridgeApiKey(
  provided: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = (env.WARA_V2_BRIDGE_API_KEY ?? "").trim();
  if (!expected) return false;
  return provided === expected;
}

export function isBridgeTenantAllowed(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.WARA_V2_BRIDGE_TENANT_ALLOWLIST ?? env.WARA_V2_SHADOW_TENANT ?? "tenant_internal_ops").trim();
  const allowed = raw.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  return allowed.includes(tenantId);
}

function isPilotOpen(env: NodeJS.ProcessEnv): boolean {
  const t = (env.WARA_V2_PILOT_OPEN ?? "").trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "si";
}

export function isBridgePhoneAllowed(phoneE164: string, env: NodeJS.ProcessEnv = process.env): boolean {
  // Paridad con cliente shadow (v1-local-ticket-bridge): piloto abierto = mismo alcance.
  if (isPilotOpen(env)) return true;
  const list = parsePhoneAllowlist(
    env.WARA_V2_BRIDGE_PHONE_ALLOWLIST ?? env.WARA_V2_SHADOW_ALLOWLIST ?? "",
  );
  if (list.length === 0) return false;
  const digits = phoneE164.replace(/\D/g, "");
  const norm = phoneE164.startsWith("+") ? phoneE164 : `+${digits}`;
  return list.includes(norm);
}

export function validateBridgeGates(input: {
  tenantId: string;
  phoneE164: string;
  env?: NodeJS.ProcessEnv;
}): { ok: true } | { ok: false; error: string } {
  const env = input.env ?? process.env;
  if (!isV2BridgeEnabled(env)) {
    return { ok: false, error: "WARA_V2_V1_TICKET_BRIDGE_ENABLED=false o WARA_V2_LAB_MODE=false" };
  }
  if (!isBridgeTenantAllowed(input.tenantId, env)) {
    return { ok: false, error: "tenant_not_in_bridge_allowlist" };
  }
  if (!isBridgePhoneAllowed(input.phoneE164, env)) {
    return { ok: false, error: "phone_not_in_bridge_allowlist" };
  }
  return { ok: true };
}

export function isLabDeliverySuppressed(env: NodeJS.ProcessEnv = process.env): boolean {
  return isV2LabMode(env) || env.DELIVERY_ENABLED === "false";
}
