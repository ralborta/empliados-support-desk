/** Identidad oficial elegida por el cliente para el asistente de Wara. */
export const WARA_ASSISTANT_NAME = "Kira";

export function buildAssistantIdentityReply(): string {
  return `Soy ${WARA_ASSISTANT_NAME}, la asistente virtual de Wara. ¿En qué te puedo ayudar?`;
}
