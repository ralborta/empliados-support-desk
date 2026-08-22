/**
 * Veto determinista para escrituras con resumen CONFIRMO pendiente.
 */
import {
  classifyConfirmoPhrase,
  isConfirmoWriteBlocked,
  looksLikeFuzzyConfirmoToken,
} from "@/lib/confirmoTokens";
import {
  looksLikeBriefConfirmation,
  looksLikeColloquialArgentineAffirmation,
  looksLikePendingTramiteAffirmation,
} from "@/lib/wara";

export {
  classifyConfirmoPhrase,
  buildConfirmoClarifyReply,
  isConfirmoWriteBlocked,
  looksLikeFuzzyConfirmoToken,
  CONFIRMO_TYPO_WHITELIST,
} from "@/lib/confirmoTokens";
export type { ConfirmoPhraseIntent } from "@/lib/confirmoTokens";

/** ¿El cliente afirma un resumen pendiente (CONFIRMO explícito o coloquial)? */
export function isAffirmationForPendingWrite(text: string | undefined | null): boolean {
  if (isConfirmoWriteBlocked(text)) return false;
  const phrase = classifyConfirmoPhrase(text);
  if (phrase === "confirm") return true;
  if (looksLikeBriefConfirmation(text)) return true;
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (looksLikeColloquialArgentineAffirmation(raw)) return true;
  return looksLikePendingTramiteAffirmation(text);
}

/** Confirmación tolerante para executors con resumen pendiente. Nunca true si rechazo/ambiguo. */
export function isConfirmedForPendingWrite(text: string | undefined | null): boolean {
  return isAffirmationForPendingWrite(text);
}
