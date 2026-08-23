/** Identificador estable devuelto por BuilderBot al aceptar un envío WA. */
export function extractBuilderBotOutboundMessageId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const root = data as Record<string, unknown>;
  const candidates: unknown[] = [
    root.id,
    root.messageId,
    root.ref,
    (root.messages as Record<string, unknown> | undefined)?.id,
    (root.respMessage as Record<string, unknown> | undefined)?.messages,
  ];
  const nestedMessages = (root.respMessage as Record<string, unknown> | undefined)?.messages;
  if (Array.isArray(nestedMessages) && nestedMessages[0] && typeof nestedMessages[0] === "object") {
    candidates.push((nestedMessages[0] as Record<string, unknown>).id);
  }
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return undefined;
}

export type WhatsAppApiSendResult = {
  skippedDuplicate?: boolean;
  providerMessageId?: string;
  rawResponse?: unknown;
};
