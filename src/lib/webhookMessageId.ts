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
  // Los eventos `message.outgoing` de BuilderBot traen el wamid real de WhatsApp
  // anidado en `respMessage.messages[0].id` (y a veces en `messages[0].id` directo),
  // no en los campos planos que ya chequeábamos. Bug real, producción 2026-07-23: al
  // no encontrar ningún id "plano", esta función caía siempre al hash por texto+ts,
  // y como esas respuestas no traen `timestamp` a nivel raíz, el bucket terminaba
  // dependiendo del segundo de llamada — dos envíos legítimos y distintos con el
  // mismo texto (p. ej. la misma pregunta de aclaración repetida en dos turnos reales)
  // no colisionaban acá, pero tampoco quedaban protegidos por un id realmente estable.
  const respMessage =
    data.respMessage && typeof data.respMessage === "object"
      ? (data.respMessage as Record<string, unknown>)
      : null;
  const respMessages = Array.isArray(respMessage?.messages) ? respMessage!.messages : null;
  const firstRespMessage =
    respMessages && respMessages[0] && typeof respMessages[0] === "object"
      ? (respMessages[0] as Record<string, unknown>)
      : null;
  const plainMessages = Array.isArray(data.messages) ? data.messages : null;
  const firstPlainMessage =
    plainMessages && plainMessages[0] && typeof plainMessages[0] === "object"
      ? (plainMessages[0] as Record<string, unknown>)
      : null;

  const stable = pickString(
    data.messageId,
    data.id,
    key?.id,
    data.wamid,
    data.msgId,
    data.message_id,
    firstRespMessage?.id,
    firstPlainMessage?.id,
  );
  if (stable) return `${direction}:${phone}:${stable}`;

  const text = (body ?? pickString(data.body)).slice(0, 500);
  const ts = pickString(data.messageTimestamp, data.timestamp, key?.messageTimestamp);
  const bucket = ts || String(Math.floor(Date.now() / 1000));
  const hash = createHash("sha256").update(`${phone}|${text}|${bucket}`).digest("hex").slice(0, 24);

  return `${direction}:${phone}:${hash}`;
}

/**
 * true si el payload trae un identificador realmente estable del proveedor (wamid u
 * otro id propio del mensaje), en vez del hash de respaldo por texto+segundo. Permite
 * decidir cuándo es seguro confiar SOLO en el id (sin heurística extra por contenido).
 */
export function hasStableWebhookMessageId(data: Record<string, unknown>): boolean {
  const key = data.key && typeof data.key === "object" ? (data.key as Record<string, unknown>) : null;
  const respMessage =
    data.respMessage && typeof data.respMessage === "object"
      ? (data.respMessage as Record<string, unknown>)
      : null;
  const respMessages = Array.isArray(respMessage?.messages) ? respMessage!.messages : null;
  const firstRespMessage =
    respMessages && respMessages[0] && typeof respMessages[0] === "object"
      ? (respMessages[0] as Record<string, unknown>)
      : null;
  const plainMessages = Array.isArray(data.messages) ? data.messages : null;
  const firstPlainMessage =
    plainMessages && plainMessages[0] && typeof plainMessages[0] === "object"
      ? (plainMessages[0] as Record<string, unknown>)
      : null;
  return !!pickString(
    data.messageId,
    data.id,
    key?.id,
    data.wamid,
    data.msgId,
    data.message_id,
    firstRespMessage?.id,
    firstPlainMessage?.id,
  );
}
