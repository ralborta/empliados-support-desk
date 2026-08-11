/**
 * Desidentificación determinística tenant-scoped (sin tabla reversible en dataset).
 */
import { createHmac, randomBytes } from "node:crypto";

export type DeidKey = { ephemeral: Buffer; created_at: string };

/** Clave efímera en memoria — no se serializa en el dataset. */
export function createEphemeralDeidKey(): DeidKey {
  return { ephemeral: randomBytes(32), created_at: new Date().toISOString() };
}

function token(
  key: DeidKey,
  tenantId: string,
  kind: string,
  value: string,
): string {
  // HMAC tenant-scoped — no hash simple de baja entropía
  const h = createHmac("sha256", key.ephemeral)
    .update(`${tenantId}|${kind}|${value}`, "utf8")
    .digest("hex");
  const n = parseInt(h.slice(0, 8), 16) % 10000;
  return `${kind}_${String(n).padStart(4, "0")}`;
}

export function pseudonymPerson(key: DeidKey, tenantId: string, name: string): string {
  return token(key, tenantId, "PERSONA", name.trim().toLowerCase());
}

export function pseudonymCompany(key: DeidKey, tenantId: string, name: string): string {
  return token(key, tenantId, "EMPRESA", name.trim().toLowerCase());
}

export function pseudonymUnit(key: DeidKey, tenantId: string, label: string): string {
  return token(key, tenantId, "UNIDAD", label.trim().toLowerCase());
}

/** Patente sintética válida en formato ficticio (no reversible). */
export function syntheticPlate(key: DeidKey, tenantId: string, plate: string): string {
  const h = createHmac("sha256", key.ephemeral)
    .update(`${tenantId}|plate|${plate}`, "utf8")
    .digest("hex");
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const a = letters[parseInt(h.slice(0, 2), 16) % letters.length]!;
  const b = letters[parseInt(h.slice(2, 4), 16) % letters.length]!;
  const c = letters[parseInt(h.slice(4, 6), 16) % letters.length]!;
  const nums = String(parseInt(h.slice(6, 9), 16) % 1000).padStart(3, "0");
  return `${a}${b}${c}${nums}`;
}

/** Teléfonos reservados ficticios +54911xxxxxxxx */
export function syntheticPhone(key: DeidKey, tenantId: string, phone: string): string {
  const h = createHmac("sha256", key.ephemeral)
    .update(`${tenantId}|phone|${phone}`, "utf8")
    .digest("hex");
  const n = String(parseInt(h.slice(0, 8), 16) % 1e8).padStart(8, "0");
  return `+54911${n}`;
}

/** Desplazamiento de fechas consistente por tenant. */
export function shiftDateIso(
  key: DeidKey,
  tenantId: string,
  iso: string,
): string {
  const h = createHmac("sha256", key.ephemeral)
    .update(`${tenantId}|date_shift`, "utf8")
    .digest("hex");
  const days = (parseInt(h.slice(0, 4), 16) % 400) - 200;
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export type RawMessage = {
  tenant_id: string;
  conversation_id: string;
  turn_index: number;
  message_role: "user" | "assistant" | "system";
  text: string;
  received_at?: string;
  unit_label?: string;
};

export type DeidMessage = {
  tenant_id: string;
  conversation_id: string;
  turn_index: number;
  message_role: "user" | "assistant" | "system";
  text: string;
  received_at?: string;
  unit_label?: string;
  synthetic: true;
  deid_version: 1;
};

/**
 * Transforma texto reemplazando patrones detectados con seudónimos.
 * No incluye la clave en la salida.
 */
export function deidentifyMessage(
  key: DeidKey,
  msg: RawMessage,
): DeidMessage {
  let text = msg.text;
  // emails
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (m) =>
    `email_${pseudonymPerson(key, msg.tenant_id, m).slice(-4)}`,
  );
  // phones rough
  text = text.replace(/(?:\+?54)?[\s-]?(?:9)?[\s-]?\d{2,4}[\s-]?\d{6,8}\b/g, (m) =>
    syntheticPhone(key, msg.tenant_id, m),
  );
  // plates
  text = text.replace(/\b[A-Z]{2}\d{3}[A-Z]{2}\b|\b[A-Z]{3}\d{3}\b/gi, (m) =>
    syntheticPlate(key, msg.tenant_id, m),
  );
  // probable names
  text = text.replace(
    /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/g,
    (m) => pseudonymPerson(key, msg.tenant_id, m),
  );

  const convId = token(key, msg.tenant_id, "CONV", msg.conversation_id);
  return {
    tenant_id: token(key, msg.tenant_id, "TENANT", msg.tenant_id).replace(
      "TENANT_",
      "tenant_synth_",
    ),
    conversation_id: convId,
    turn_index: msg.turn_index,
    message_role: msg.message_role,
    text,
    received_at: msg.received_at
      ? shiftDateIso(key, msg.tenant_id, msg.received_at)
      : undefined,
    unit_label: msg.unit_label
      ? pseudonymUnit(key, msg.tenant_id, msg.unit_label)
      : undefined,
    synthetic: true,
    deid_version: 1,
  };
}
