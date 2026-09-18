/**
 * Detector de cierre de conversación (V3).
 * Mantener alineado con src/lib/customerConversationCloseDetect.ts
 */

function normCloseText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const CUSTOMER_CLOSE_SUCCESS_MESSAGE =
  "Listo, cerré tu consulta. Gracias por escribirnos. Si necesitás algo más, quedo a disposición por este medio.";

/** Pedido de cerrar/resolver la conversación o el caso (no un problema técnico). */
export function looksLikeCustomerConversationCloseRequest(
  text: string | undefined | null,
): boolean {
  const t = normCloseText(text ?? "");
  if (!t || t.length > 140) return false;

  const caseWord =
    "(conversacion(es)?|charlas?|chats?|casos?|tickets?|consultas?|reclamos?)";

  if (
    new RegExp(
      `^(cerrar|resolver|finalizar|terminar)\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?${caseWord}\\b`,
    ).test(t)
  ) {
    return true;
  }

  if (new RegExp(`^(cerrar|resolver|finalizar)\\s+${caseWord}\\b`).test(t)) {
    return true;
  }

  if (new RegExp(`\\bcerr(a|ame|ar)\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?${caseWord}\\b`).test(t)) {
    return true;
  }

  if (new RegExp(`\\b(cerrame)\\s+(el\\s+|los\\s+|la\\s+|las\\s+)?${caseWord}\\b`).test(t)) {
    return true;
  }

  if (/\b(dar por cerrad[oa]|dar por resuelt[oa]|dalo por cerrado)\b/.test(t)) {
    return true;
  }

  if (/\b(quiero|necesito|me gustar[ií]a|pod[eé]s|podes)\s+(cerrar|dar por cerrad)/.test(t)) {
    return true;
  }

  if (new RegExp(`\\b(cerrar|resolver)\\s+(mi|el|un|los|las|mis)\\s+${caseWord}\\b`).test(t)) {
    return true;
  }

  if (
    new RegExp(
      `\\b(quiero|necesito)\\s+.*\\b(cerrar|resolver|finalizar|terminar)\\b.*\\b${caseWord}\\b`,
    ).test(t)
  ) {
    return true;
  }

  if (
    new RegExp(
      `\\b(pasar|poner|dejar|marcar)\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?${caseWord}\\s+a\\s+(resuelto|resuelta|cerrado|cerrada|finalizado|finalizada)\\b`,
    ).test(t)
  ) {
    return true;
  }

  if (/\b(pasar|poner|marcar)\s+a\s+(resuelto|resuelta|cerrado|cerrada|finalizado|finalizada)\b/.test(t)) {
    return true;
  }

  if (
    new RegExp(
      `^(si|sí|dale|ok|bueno|si por favor|sí por favor)[,.\\s]+(resolver|cerrar|finalizar)\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?${caseWord}\\b`,
    ).test(t)
  ) {
    return true;
  }

  if (new RegExp(`\\b(resolver|cerrar|finalizar)\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?${caseWord}\\b`).test(t)) {
    return true;
  }

  if (
    new RegExp(
      `\\b(resolverme|resolv[eé]me|resolveme)\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?${caseWord}\\b`,
    ).test(t)
  ) {
    return true;
  }

  if (
    new RegExp(
      `\\b(no te preocupes|no importa|olvida|olvidalo)\\b.{0,50}\\b(resolver|cerrar|finalizar)\\s+(la\\s+|el\\s+|los\\s+|las\\s+)?${caseWord}\\b`,
    ).test(t)
  ) {
    return true;
  }

  return false;
}
