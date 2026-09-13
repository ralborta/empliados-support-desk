/**
 * Clasificación determinista de CONFIRMO (sin startsWith("conf"), sin Levenshtein).
 */

/** Typos WhatsApp aceptados solo con confirmación pendiente en hilo. */
export const CONFIRMO_TYPO_WHITELIST = new Set(["comnfirmo", "confimo", "confimro"]);

export type ConfirmoPhraseIntent = "none" | "confirm" | "reject" | "clarify";

function normPhrase(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lettersOnly(text: string): string {
  return normPhrase(text).replace(/[^a-z]/g, "");
}

/**
 * Clasifica mensajes centrados en CONFIRMO (negación manda primero).
 * No sustituye afirmaciones coloquiales ("dale", "joya").
 */
export function classifyConfirmoPhrase(text: string | undefined | null): ConfirmoPhraseIntent {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 160) return "none";
  const rawLower = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/^no\s*,\s*confirmo\b/.test(rawLower)) return "clarify";

  const norm = normPhrase(raw);
  if (/\bconfirmo\s+que\s+no\b/.test(norm)) return "reject";
  if (/\bno\s+confirmo\b/.test(norm)) return "reject";
  if (/\bno\s+quiero\s+confirmar\b/.test(norm)) return "reject";

  const token = lettersOnly(raw);
  if (CONFIRMO_TYPO_WHITELIST.has(token) || token === "confirmo") return "confirm";
  // Imperativo / infinitivo que el cliente usa en vez de CONFIRMO literal.
  if (token === "confirmar" || token === "confirma" || token === "confirmacion") return "confirm";

  return "none";
}

/** Token único ≈ confirmo (whitelist cerrada). */
export function looksLikeFuzzyConfirmoToken(token: string | undefined | null): boolean {
  const t = lettersOnly(String(token ?? ""));
  if (!t) return false;
  return CONFIRMO_TYPO_WHITELIST.has(t) || t === "confirmo";
}

export function buildConfirmoClarifyReply(): string {
  return (
    "No me quedó claro: ¿querés *confirmar* el registro respondiendo CONFIRMO, o estás diciendo que *no*?"
  );
}

/**
 * Negación / veto semántico sobre una aparente afirmación coloquial.
 * Cubre «Claro que no», «Obvio que no», «Sí, pero no lo confirmes», «Dale, pero no lo hagas».
 */
export function hasPendingWriteNegationCue(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const norm = normPhrase(raw);
  if (!norm) return false;
  if (/\b(claro|obvio|seguro|si|sip|dale|ok|okey)\s+que\s+no\b/.test(norm)) return true;
  if (/\bno\s+lo\s+(confirm|hag|registr|hac)/.test(norm)) return true;
  if (/\bno\s+(confirm|hag|registr)/.test(norm)) return true;
  if (/\bpero\s+no\b/.test(norm) && /\b(confirm|hag|registr|hac)/.test(norm)) return true;
  if (/\b(no\s+quiero|no\s+confirmes|cancelar|cancelalo|olvidalo|negativo)\b/.test(norm)) {
    return true;
  }
  return false;
}

export function isConfirmoWriteBlocked(text: string | undefined | null): boolean {
  if (hasPendingWriteNegationCue(text)) return true;
  const phrase = classifyConfirmoPhrase(text);
  return phrase === "reject" || phrase === "clarify";
}
