import { createHash } from "crypto";

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/**
 * ID estable para idempotencia de webhooks BuilderBot/WhatsApp.
 * Prioriza IDs del proveedor; si no hay, hash de teléfono + cuerpo + timestamp.
 */
export function buildWebhookMessageId(params: {
  data: Record<string, unknown>;
  phone: string;
  direction: "inbound" | "outbound";
  body?: string;
}): string {
  const { data, phone, direction, body } = params;
  const key = data.key && typeof data.key === "object" ? (data.key as Record<string, unknown>) : null;

  const stable = pickString(
    data.messageId,
    data.id,
    key?.id,
    data.wamid,
    data.msgId,
    data.message_id,
  );
  if (stable) return `${direction}:${phone}:${stable}`;

  const text = (body ?? pickString(data.body)).slice(0, 500);
  const ts = pickString(data.messageTimestamp, data.timestamp, key?.messageTimestamp);
  const bucket = ts || String(Math.floor(Date.now() / 1000));
  const hash = createHash("sha256").update(`${phone}|${text}|${bucket}`).digest("hex").slice(0, 24);

  return `${direction}:${phone}:${hash}`;
}
