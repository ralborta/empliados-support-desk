import {
  hasPendingCertificateConfirmation,
  hasPendingMantenimientoConfirmation,
  hasPendingOdometerConfirmation,
  looksLikeBriefConfirmation,
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
  if (!looksLikeBriefConfirmation(selectionText)) return null;
  if (hasPendingCertificateConfirmation(threadText)) return "certificados";
  if (hasPendingOdometerConfirmation(threadText)) return "odometro";
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
