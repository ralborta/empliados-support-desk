import {
  hasPendingCertificateConfirmation,
  hasPendingMantenimientoConfirmation,
  hasPendingOdometerConfirmation,
  looksLikeBareMeterValue,
  looksLikePendingTramiteAffirmation,
  threadAwaitingOdometerConfirmDetails,
  threadHasActiveMeterValueRequest,
} from "@/lib/wara";
import type { TurnExecutorId } from "@/lib/whatsappTurnRouter";

/** Ejecutores que aceptan CONFIRMO / sí / dale sobre un resumen pendiente. */
export type PendingConfirmationExecutor = Extract<
  TurnExecutorId,
  "certificados" | "odometro" | "mantenimiento"
>;

/**
 * Prioridad única de confirmaciones pendientes (backend + tests + BBC deben coincidir):
 * 1. Certificado  2. Odómetro  3. Mantenimiento
 */
export function resolvePendingConfirmationExecutor(
  threadText: string,
  selectionText: string,
): PendingConfirmationExecutor | null {
  if (!looksLikePendingTramiteAffirmation(selectionText)) return null;
  // "55" u otro valor numérico durante pedido de km/hs → odómetro, no mantenimiento stale.
  if (looksLikeBareMeterValue(selectionText) && threadHasActiveMeterValueRequest(threadText)) {
    return null;
  }
  if (hasPendingCertificateConfirmation(threadText)) return "certificados";
  if (hasPendingOdometerConfirmation(threadText) || threadAwaitingOdometerConfirmDetails(threadText)) {
    return "odometro";
  }
  if (hasPendingMantenimientoConfirmation(threadText)) return "mantenimiento";
  return null;
}

export function hasAnyPendingConfirmation(threadText: string): boolean {
  return (
    hasPendingCertificateConfirmation(threadText) ||
    hasPendingOdometerConfirmation(threadText) ||
    hasPendingMantenimientoConfirmation(threadText)
  );
}

/** Agradecimiento breve mientras hay un CONFIRMO pendiente — no cerrar el trámite. */
export function buildPendingConfirmationPoliteAckReply(
  threadText: string,
  firstName?: string | null,
): string {
  const greet = firstName?.trim() ? `${firstName.trim()}, ` : "";
  if (hasPendingOdometerConfirmation(threadText)) {
    return (
      `${greet}de nada. Todavía tengo pendiente el registro del resumen anterior. ` +
      `¿Querés confirmarlo respondiendo CONFIRMO, corregir algún dato, o preferís hacer otra gestión?`
    );
  }
  if (hasPendingCertificateConfirmation(threadText)) {
    return (
      `${greet}de nada. Sigo con el certificado pendiente de confirmación — ` +
      `respondé CONFIRMO si está bien, o decime qué corregir.`
    );
  }
  if (hasPendingMantenimientoConfirmation(threadText)) {
    return (
      `${greet}de nada. El mantenimiento del resumen sigue pendiente — ` +
      `respondé CONFIRMO para registrarlo o decime si querés cambiar algo.`
    );
  }
  return `${greet}de nada. ¿Necesitás algo más?`;
}
