/**
 * Contrato de capas del turno WhatsApp (V1). Ver docs/WARA-TURN-LAYER-CONTRACT.md
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import {
  hasPendingOdometerConfirmation,
  looksLikeCertificateKeyword,
  looksLikeMaintenanceKeyword,
  threadAwaitingHorometerKmValue,
  threadAwaitingHorometerPlate,
  threadAwaitingOdometerKmValue,
  threadAwaitingOdometerPlate,
  threadHasActiveOdometerFlow,
} from "@/lib/wara";
import { looksLikeMaintenanceExplorationRequest } from "@/lib/waraApi";
import {
  looksLikeResumeInconclusiveTramite,
  looksLikeTramiteCancellationIntent,
} from "@/lib/tramiteFlowControl";
import { looksLikeResumePausedTramite } from "@/lib/wara";

/** Qué debe ser el próximo mensaje sustantivo del cliente. */
export type ActiveExpectationField =
  | "unit"
  | "km"
  | "fecha_hora"
  | "fork_choice"
  | "confirmo"
  | "detail";

export type TurnLayerPayload = {
  activeExpectation?: ActiveExpectationField | null;
  /** Tras consulta lateral: expectativa operativa que se pausa. */
  pausedExpectation?: ActiveExpectationField | null;
  /** Tras consulta lateral: esperando «seguimos» vs «cambiar». */
  forkPending?: boolean;
  /** Pausa informativa (CONFIRMO u otro); no cancela el trámite. */
  lateralPause?: boolean;
};

export type TramiteForkChoice = "resume" | "switch" | "ambiguous";

export type ExplicitOtherTramite = "mantenimiento" | "certificados";

export function readTurnLayer(
  pendingAction: PendingActionRecord | null | undefined,
): TurnLayerPayload | null {
  const raw = pendingAction?.payload?.turnLayer;
  if (!raw || typeof raw !== "object") return null;
  return raw as TurnLayerPayload;
}

export function isTurnLayerForkPending(
  pendingAction: PendingActionRecord | null | undefined,
): boolean {
  const layer = readTurnLayer(pendingAction);
  return layer?.forkPending === true || layer?.activeExpectation === "fork_choice";
}

/** Inferir expectativa dominante desde el hilo (fallback si no hay turnLayer en DB). */
export function inferActiveExpectationFromThread(threadText: string): ActiveExpectationField | null {
  if (!threadText.trim()) return null;
  if (hasPendingOdometerConfirmation(threadText)) return "confirmo";
  if (threadAwaitingTramiteForkChoice(threadText)) return "fork_choice";
  if (threadAwaitingOdometerPlate(threadText) || threadAwaitingHorometerPlate(threadText)) {
    return "unit";
  }
  if (threadAwaitingOdometerKmValue(threadText) || threadAwaitingHorometerKmValue(threadText)) {
    return "km";
  }
  if (threadHasActiveOdometerFlow(threadText)) return "unit";
  return null;
}

/** El bot acaba de pedir bifurcación tras consulta lateral o pivot de unidad. */
export function threadAwaitingTramiteForkChoice(threadText: string): boolean {
  const tail = threadText.slice(-3200);
  if (/\bconsultar ahora\b/i.test(tail) && /\bseguir con\b/i.test(tail)) return true;
  return (
    /\bcambiar de requerimiento\b/i.test(tail) &&
    /\bseguimos con el\b/i.test(tail)
  );
}

export function looksLikeExplicitOtherTramiteIntent(text: string): ExplicitOtherTramite | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (looksLikeMaintenanceKeyword(raw) || looksLikeMaintenanceExplorationRequest(raw)) {
    return "mantenimiento";
  }
  if (looksLikeCertificateKeyword(raw)) return "certificados";
  return null;
}

export function looksLikeTramiteForkSwitchIntent(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (looksLikeExplicitOtherTramiteIntent(raw)) return true;
  return (
    /\b(cambiar de requerimiento|cambiar de tema|otro requerimiento|otro tramite|otra cosa|otro tema)\b/.test(
      t,
    ) ||
    /\b(prefiero|quiero)\b.{0,24}\b(mantenimiento|certificado|cobertura|horometro|odometro)\b/.test(
      t,
    ) ||
    /\b(el|la)\s+(mantenimiento|certificado)\b/.test(t) ||
    // Pivote medidor ↔ medidor (ej. CONFIRMO odómetro + "Horometro")
    /^(el\s+|la\s+)?(horometro|odometro|kilometraje)s?$/.test(t) ||
    /\bcambiar\b/.test(t)
  );
}

export function looksLikeTramiteForkResumeIntent(text: string): boolean {
  if (looksLikeResumePausedTramite(text) || looksLikeResumeInconclusiveTramite(text)) {
    return true;
  }
  const t = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || looksLikeTramiteCancellationIntent(text)) return false;
  return (
    /\b(seguimos|sigamos|continuemos|retomemos)\b.{0,30}\b(odometro|horometro|cambio)\b/.test(t) ||
    /\b(el|la)\s+(odometro|horometro)\b/.test(t) ||
    /\bseguimos con\b/.test(t)
  );
}

export function classifyTramiteForkChoiceResponse(text: string): TramiteForkChoice | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const resume = looksLikeTramiteForkResumeIntent(raw);
  const switchIntent = looksLikeTramiteForkSwitchIntent(raw);
  if (resume && switchIntent) return "ambiguous";
  if (switchIntent) return "switch";
  if (resume) return "resume";
  if (looksLikeExplicitOtherTramiteIntent(raw)) return "switch";
  return null;
}

export function buildTramiteForkClarificationReply(isHoro: boolean): string {
  const topic = isHoro ? "horómetro" : "odómetro";
  return (
    `Para seguir: decime si *seguimos con el cambio de ${topic}* o si preferís *cambiar de requerimiento* (mantenimiento, certificado, consulta GPS, etc.).`
  );
}

export function mergeTurnLayerPatch(
  pendingAction: PendingActionRecord | null | undefined,
  patch: TurnLayerPayload,
): Record<string, unknown> {
  const prev = readTurnLayer(pendingAction) ?? {};
  return {
    ...(pendingAction?.payload ?? {}),
    turnLayer: { ...prev, ...patch },
  };
}

export function buildCollectingPayloadForFork(
  threadText: string,
  existingPayload?: Record<string, unknown> | null,
): Record<string, unknown> {
  const pausedExpectation = inferActiveExpectationFromThread(threadText);
  const prevLayer = (existingPayload?.turnLayer as TurnLayerPayload | undefined) ?? {};
  return {
    ...(existingPayload ?? {}),
    stage: existingPayload?.stage ?? "collecting",
    turnLayer: {
      ...prevLayer,
      activeExpectation: "fork_choice",
      forkPending: true,
      lateralPause: true,
      pausedExpectation,
    },
  };
}
