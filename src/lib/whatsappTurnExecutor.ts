import { NextRequest } from "next/server";
import { POST as odooTicketPost } from "@/app/api/odoo/ticket/route";
import { POST as certificadosPost } from "@/app/api/wara/certificados/route";
import { POST as infoGuidesPost } from "@/app/api/wara/info-guides/route";
import { POST as mantenimientoPost } from "@/app/api/wara/mantenimiento-operativo/route";
import { POST as odometroPost } from "@/app/api/wara/odometro-horometro/route";
import { POST as unidadesPost } from "@/app/api/wara/unidades/route";
import { loadTurnThreadContext } from "@/lib/conversationThread";
import {
  TURN_EXECUTOR_PATH,
  type TurnExecutorId,
} from "@/lib/whatsappTurnRouter";
import { resolveTurnExecutor } from "@/lib/whatsappTurnClassifierAI";
import {
  clarificationFromUnderstanding,
  shouldAnswerOpenCaseFromUnderstanding,
  shouldForceUnidadesFromUnderstanding,
  shouldInterpretAmbiguousUtterance,
  shouldProceedAsVehicleUnit,
  understandUserUtterance,
  unitSearchHintFromUnderstanding,
  actionRiskFromUnderstanding,
  shouldClarifyUnitWithoutStatusAction,
  buildUnitReferenceClarifyReply,
  type UtteranceUnderstanding,
} from "@/lib/utteranceUnderstanding";
import {
  canReuseContextUnitForTurn,
  decideUnitConsultMode,
  hasStatusReadMessageUnitEntity,
  movilIdFromMessageUnderStatusRead,
} from "@/lib/unitConsultTurnDecision";
import { getSessionNotebook, resolveContextUnitPlate } from "@/lib/conversationNotebook";
import { buildBriefServiceScopeConsultationReply } from "@/lib/waraWhatsAppFormat";
import { askCertificateUnitMessage, looksLikeCertificateUnitPivot } from "@/lib/certificateFlowMessages";
import { looksLikeCustomerConversationCloseRequest } from "@/lib/customerConversationClose";
import {
  extractUnitCandidatesFromVisionText,
  shouldRouteGpsConsultToUnidades,
} from "@/lib/gpsConsultRouting";
import {
  looksLikeCustomerImageAttachmentCue,
  looksLikeInboundMediaOnlyEvent,
  NO_IMAGE_ANALYSIS_REPLY,
  selectionHasAiImageContext,
  withNoImageAnalysisNotice,
} from "@/lib/inboundImagePolicy";
import {
  buildUnexpectedTurnFallbackMessage,
  looksLikeChangeCompanyRequest,
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeGpsFeatureIssueForAdvisor,
  looksLikeHumanAdvisorRequest,
  looksLikeOutOfScopeSupportClaim,
  looksLikeTechnicalSupportRequest,
  looksLikeGenericCapabilityOrTopicSwitchRequest,
  looksLikeExplicitCapabilityMenuRequest,
  buildAtilioHelpCapabilitiesReply,
  looksLikeServiceScopeConsultationMeta,
  looksLikeGenericUnitConsultWithoutPlate,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeUnitConsultFollowUp,
  looksLikeUnitReportingStatusCue,
  looksLikeSubstantiveCustomerMessage,
  threadHasRecentUnitProblemListenPrompt,
  looksLikeOperationalMaintenanceIntent,
  looksLikeOpcionesInfoRequest,
  looksLikeUnidadesInfoRequest,
  threadHasRecentNoEquipmentExplanation,
  threadHasRecentUnitCaseOpened,
  looksLikeColloquialGratitudeAck,
  looksLikeConversationAcknowledgement,
} from "@/lib/waraApi";
import {
  detectPendingConfirmKind,
  looksLikePendingConfirmPushback,
  reasonPendingConfirmationRejection,
  buildPendingConfirmStillWaitingReminder,
  buildPendingConfirmHelpReply,
  classifyOdometerFlowSideQuestion,
  buildOdometerFlowSideQuestionReply,
} from "@/lib/pendingConfirmStance";
import { buildOpenCaseStatusReply } from "@/lib/customerTicketInquiry";
import { looksLikeChangeCompanyRequestHybrid } from "@/lib/whatsappAdminIntentAI";
import { shouldRouteTurnToFleetListExecutorHybrid } from "@/lib/fleetListIntentAI";
import {
  buildAggregateFleetComparisonLimitReply,
  classifyFleetQueryKind,
} from "@/lib/fleetQueryKind";
import {
  isBarePlatePrefixHint,
  looksLikeBriefConfirmation,
  looksLikePendingTramiteAffirmation,
  looksLikeResumePausedTramite,
  looksLikePendingConfirmComprehensionAck,
  looksLikePendingConfirmHelpOrConfusion,
  detectLoosePlate,
  extractPlatePrefixFromMessage,
  hasPendingMaintenancePlateRequest,
  isPlausibleVehiclePlate,
  normalizePlate,
  threadHasActiveOdometerFlow,
  threadHasOdometerUnitClarificationPending,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerKmValue,
  threadOdometerRegistrationCompleted,
  looksLikeCertificateKeyword,
  certificateFlowState,
  hasPendingCertificateConfirmation,
  hasPendingOdometerConfirmation,
  shouldContinueCertificateUnitCollection,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  looksLikeBareOdometerTopicMention,
  looksLikeBareHorometerTopicMention,
  hasPendingMantenimientoConfirmation,
  extractPendingMaintenanceDetalle,
  isOdometerFlowSuperseded,
  looksLikeBareMeterValue,
  looksLikeOdometerInfoRequest,
  threadHasActiveMeterValueRequest,
  looksLikeStructuredOdometerUpdateRequest,
  looksLikeUnitRejection,
  looksLikeBareNegativeResponse,
  looksLikeAnotherUnitConsultRequest,
  threadHasRecentCustomerMeterUpdateIntent,
  threadHasRecentCertificateSuccess,
  threadHasRecentMaintenanceSuccess,
} from "@/lib/wara";
import {
  getActiveUnit,
  shouldUseActiveUnitFallback,
  clearActiveUnit,
} from "@/lib/activeUnit";
import {
  isMaintenancePlateSelectionMessage,
  isOdometerPlateSelectionMessage,
  shouldRouteTurnToOdometerExecutor,
  shouldRouteTurnToUnidadesExecutor,
  buildFleetUnitNotFoundMessage,
  looksLikeFleetUnitSearchInput,
  looksLikeUnitNameInMessage,
  extractFreeTextUnitSearchCandidate,
  extractExplicitUnitNameFromText,
  extractMovilIdFromUnitMessage,
  resolveExecutorOverStaleMaintenancePlateSelection,
} from "@/lib/waraUnitIntent";
import { waitUntil } from "@vercel/functions";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import { extractMediaUrlAndCleanText } from "@/lib/mediaUrlMarker";
import { sendWhatsAppTextWithOptionalMedia } from "@/lib/whatsappMediaDelivery";
import { shouldDeliverWhatsAppToProtectedClient } from "@/lib/waraTurnDeliveryGuard";
import {
  getPendingAction,
  clearPendingAction,
  ensureOdometerCollectingTurnLayer,
  ensurePendingOperationForkLayer,
  patchPendingActionPayload,
} from "@/lib/pendingAction";
import {
  hasPendingOdometerActionChoice,
  looksLikeOdometerActionChoiceReply,
  shouldSupersedeOdometerActionChoice,
} from "@/lib/odometerActionChoice";
import {
  looksLikeTramiteCancellationIntent,
  threadHasInconclusiveTramite,
  buildTramiteCancellationReply,
  looksLikeResumeInconclusiveTramite,
  buildInconclusiveTramiteResumePrompt,
  resolveExecutorForInconclusiveTramite,
} from "@/lib/tramiteFlowControl";
import {
  classifyPivotForkChoiceResponse,
  buildPivotForkClarificationReply,
  buildResumeTurnLayerPatch,
  prepareStatusPivotDuringTramite,
  readPivotIntent,
  logTramitePivotTrace,
  extractTramiteUnitAnchorFromThread,
} from "@/lib/tramitePivot";
import {
  buildTramiteForkClarificationReply,
  buildCollectingPayloadForFork,
  buildForkLayerPersistFailureReply,
  isTurnLayerForkPending,
  looksLikeExplicitOtherTramiteIntent,
  threadAwaitingTramiteForkChoice,
  readPendingClarification,
  readTurnLayer,
  buildUnitRefClarificationTurnLayer,
  clearClarificationRestoreExpectation,
} from "@/lib/turnLayerContract";
import { prisma } from "@/lib/db";
import { runAtilioAgentTurn } from "@/lib/atilioAgent";
import { resolvePendingConfirmationExecutor, hasAnyPendingConfirmation } from "@/lib/pendingConfirmation";
import { classifyConfirmoPhrase, buildConfirmoClarifyReply } from "@/lib/confirmoTokens";
import {
  classifyTypedLateralQuery,
  tramiteAllowsTypedLateralOverlay,
  buildTypedLateralReply,
  shouldSkipTypedLateralForOdometerFlow,
  type TypedLateralKind,
} from "@/lib/typedLateralQueries";
import {
  decidePendingWriteInterference,
  actionRiskFromTypedLateralKind,
  isPendingWriteActionType,
  buildOverlayResumeHintFromCurrentPending,
  composeOverlayReadKeepPendingReply,
  buildUnitRefClarificationPersistFailureReply,
  type ActionWriteRisk,
} from "@/lib/pendingWriteInterference";
import {
  classifyOperationPrecedence,
  buildIncompatibleWriteForkReply,
} from "@/lib/operationModuleAdapters";
import { isExplicitUnitStatusQuery } from "@/lib/tramiteMeterPrecedence";
import {
  agentComposeRequested,
  parseExecutorDialogueState,
} from "@/lib/executorDialogueState";
import {
  composeAgentReplyFromDialogueState,
} from "@/lib/atilioDialogueCompose";
import { isPassthroughGpsWhatsAppMessage } from "@/lib/waraGpsSummary";
import { isStructuredWhatsAppTemplate } from "@/lib/waraWhatsAppFormat";
import type { PendingActionRecord } from "@/lib/pendingAction";

type JsonRecord = Record<string, unknown>;

type ExecutorHandler = (req: NextRequest) => Promise<Response>;

const EXECUTOR_HANDLERS: Record<TurnExecutorId, ExecutorHandler> = {
  unidades: unidadesPost,
  odometro: odometroPost,
  certificados: certificadosPost,
  mantenimiento: mantenimientoPost,
  odoo_ticket: odooTicketPost,
  info_guides: infoGuidesPost,
};

type OverlayUnidadesExtras = {
  platePrefix?: string;
  plate?: string;
  unitSearchText?: string;
  /** Acción estructurada del intérprete — autoridad telemetría vs síntoma. */
  utteranceAction?: string;
};

type OverlayReadKeepPendingResult = {
  message: string;
  executor: TurnExecutorId;
  ok: boolean;
};

function looksLikePendingCertificateUnitReply(text: string, threadText = ""): boolean {
  return shouldContinueCertificateUnitCollection(text, threadText);
}

function executorBody(
  rawPhone: string,
  body: string,
  extras?: {
    platePrefix?: string;
    plate?: string;
    unitSearchText?: string;
    ephemeralOverlayRead?: boolean;
    utteranceAction?: string;
  },
): JsonRecord {
  return {
    from: rawPhone,
    phone: rawPhone,
    body,
    rawText: body,
    ...(extras?.platePrefix ? { platePrefix: extras.platePrefix } : {}),
    ...(extras?.plate ? { patente: extras.plate, plate: extras.plate } : {}),
    ...(extras?.unitSearchText ? { unitSearchText: extras.unitSearchText } : {}),
    ...(extras?.ephemeralOverlayRead ? { ephemeralOverlayRead: true } : {}),
    ...(extras?.utteranceAction ? { utteranceAction: extras.utteranceAction } : {}),
  };
}

async function invokeExecutor(
  executor: TurnExecutorId,
  rawPhone: string,
  body: string,
  apiKey: string,
  extras?: {
    platePrefix?: string;
    plate?: string;
    unitSearchText?: string;
    ephemeralOverlayRead?: boolean;
    utteranceAction?: string;
  },
): Promise<JsonRecord> {
  const handler = EXECUTOR_HANDLERS[executor];
  const req = new NextRequest(`http://internal${TURN_EXECUTOR_PATH[executor]}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(executorBody(rawPhone, body, extras)),
  });
  const res = await handler(req);
  return (await res.json().catch(() => ({}))) as JsonRecord;
}

/**
 * Única ruta de overlay read-keep-pending.
 * Solo aquí se invoca unidades con ephemeralOverlayRead, se arma el hint
 * declarativo y se compone la respuesta. Ramas tipada / explícita / semántica
 * deben converger aquí.
 *
 * Tras la herramienta, relee pendingAction: el hint refleja el estado actual
 * (trámite avanzó / terminó / canceló mientras esperaba telemetría).
 */
async function executeOverlayReadKeepPending(opts: {
  rawPhone: string;
  selectionText: string;
  apiKey: string;
  thread: string;
  pendingAction: PendingActionRecord | null | undefined;
  pendingKind: string | null | undefined;
  mode: "gps_unidades" | "typed_lateral";
  typedLateralKind?: TypedLateralKind | null;
  unidadesExtras?: OverlayUnidadesExtras;
  prepareStatusPivot?: boolean;
}): Promise<OverlayReadKeepPendingResult | null> {
  const {
    rawPhone,
    selectionText,
    apiKey,
    thread,
    pendingAction,
    pendingKind,
    mode,
    typedLateralKind,
    unidadesExtras,
    prepareStatusPivot,
  } = opts;

  let lateralBody = "";
  let lateralOk = true;
  let usedGpsUnidades = false;

  if (mode === "gps_unidades") {
    if (prepareStatusPivot) {
      await prepareStatusPivotDuringTramite({
        prisma,
        rawPhone,
        selectionText,
        threadText: thread,
        pendingAction: pendingAction ?? null,
      }).catch(() => null);
    }
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey, {
      ephemeralOverlayRead: true,
      ...(unidadesExtras ?? {}),
    });
    lateralBody = messageFromPayload(execResult);
    lateralOk = execResult.ok !== false && execResult.ok_s !== "false";
    usedGpsUnidades = true;
    if (!lateralBody) {
      lateralBody =
        "No pude consultar el estado ahora. Si querés, repetí la consulta con patente o interno.";
      lateralOk = false;
    }
  } else if (typedLateralKind) {
    lateralBody = await buildTypedLateralReply(
      prisma,
      rawPhone,
      typedLateralKind,
      selectionText,
    );
  } else {
    return null;
  }

  if (!lateralBody.trim()) return null;

  // Releer pending: no usar snapshot previo para el resume hint.
  const currentPending = await getPendingAction(prisma, rawPhone);
  const tramiteAnchor = extractTramiteUnitAnchorFromThread(thread);
  const resumeHint = buildOverlayResumeHintFromCurrentPending({
    pendingAction: currentPending,
    pendingKind: currentPending ? pendingKind : null,
    threadText: thread,
    plateDisplayFallback: tramiteAnchor?.displayLabel ?? tramiteAnchor?.plate ?? null,
  });

  let executor: TurnExecutorId = "unidades";
  if (currentPending?.type === "certificados") {
    executor = "certificados";
  } else if (currentPending?.type === "mantenimiento") {
    executor = "mantenimiento";
  } else if (currentPending?.type === "odometro") {
    // Overlay GPS durante write: label del write pendiente (contrato explícito).
    executor = "odometro";
  } else if (usedGpsUnidades) {
    executor = "unidades";
  } else if (typedLateralKind === "gps_unit_status") {
    executor = "unidades";
  } else {
    executor = "info_guides";
  }

  return {
    message: composeOverlayReadKeepPendingReply(lateralBody, resumeHint),
    executor,
    ok: lateralOk,
  };
}

/** Respuesta segura si no se pudo persistir pendingClarification (sin falsa continuidad). */
function buildClarificationPersistFailureReply(unitLabel?: string | null): string {
  return buildUnitRefClarificationPersistFailureReply(unitLabel);
}

async function persistUnitRefClarificationOrSafeReply(opts: {
  rawPhone: string;
  thread: string;
  pendingAction: PendingActionRecord | null | undefined;
  understanding: UtteranceUnderstanding | null;
  unitKind: string;
  unitValue: string;
  /** Executor/adaptador dueño del trámite (no hardcodear odómetro). */
  executor: TurnExecutorId;
}): Promise<{ message: string; executor: TurnExecutorId; ok: boolean }> {
  const persisted = await patchPendingActionPayload(prisma, opts.rawPhone, {
    turnLayer: buildUnitRefClarificationTurnLayer(opts.thread, opts.pendingAction, {
      kind: opts.unitKind,
      value: opts.unitValue,
    }),
  }).catch((err) => {
    console.warn(
      "[pendingClarification] persist failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  });
  if (!persisted) {
    return {
      message: buildClarificationPersistFailureReply(opts.unitValue),
      executor: opts.executor,
      ok: true,
    };
  }
  return {
    message: buildUnitReferenceClarifyReply(opts.understanding),
    executor: opts.executor,
    ok: true,
  };
}

function executorFromPendingAction(
  pendingAction: PendingActionRecord | null | undefined,
): TurnExecutorId {
  if (pendingAction?.type === "certificados") return "certificados";
  if (pendingAction?.type === "mantenimiento") return "mantenimiento";
  return "odometro";
}

async function openIncompatibleWriteForkOrSafeReply(opts: {
  rawPhone: string;
  thread: string;
  pendingAction: PendingActionRecord | null | undefined;
  pendingOperation: string | null;
  pausedExpectation?: string | null;
  executor: TurnExecutorId;
  message?: string;
}): Promise<{ message: string; executor: TurnExecutorId; ok: boolean }> {
  const forkOk = await ensurePendingOperationForkLayer({
    prisma,
    phone: opts.rawPhone,
    pendingAction: opts.pendingAction,
    pendingOperation: opts.pendingOperation,
    pausedExpectation: opts.pausedExpectation,
    threadText: opts.thread,
  });
  if (!forkOk.ok) {
    return {
      message: buildForkLayerPersistFailureReply(),
      executor: opts.executor,
      ok: true,
    };
  }
  return {
    message: opts.message ?? buildIncompatibleWriteForkReply(opts.pendingOperation),
    executor: opts.executor,
    ok: true,
  };
}

function rawMessageFromPayload(data: JsonRecord): string {
  return String(data.message ?? data.summaryText ?? "").trim();
}

function mediaUrlFromPayload(data: JsonRecord): string | undefined {
  const explicit = String(data.mediaUrl ?? data.mediaUrl_s ?? "").trim();
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;
  return extractMediaUrlAndCleanText(rawMessageFromPayload(data)).mediaUrl;
}

function messageFromPayload(data: JsonRecord): string {
  const raw = rawMessageFromPayload(data);
  if (!raw) return "";
  return extractMediaUrlAndCleanText(raw).text;
}

function phaseFromExecResult(
  execResult: JsonRecord,
  message: string,
  executor: TurnExecutorId,
  ok: boolean,
): { message: string; mediaUrl?: string; executor: TurnExecutorId; ok: boolean } {
  return {
    message,
    mediaUrl: message ? mediaUrlFromPayload(execResult) : undefined,
    executor,
    ok,
  };
}

function shouldUseAgentCompose(execResult: JsonRecord): boolean {
  if (!agentComposeRequested(execResult)) return false;
  const template = messageFromPayload(execResult);
  if (isStructuredWhatsAppTemplate(template)) return false;
  return !isPassthroughGpsWhatsAppMessage(template);
}

function executorSkippedSilently(data: JsonRecord): boolean {
  return String(data.skipResponse_s ?? "") === "true" && !messageFromPayload(data);
}

function looksLikeCertificateRequest(text: string): boolean {
  return looksLikeCertificateKeyword(text);
}

function inferRecoveryExecutor(
  selectionText: string,
  failedExecutor: TurnExecutorId,
  threadText: string,
  execResult?: JsonRecord,
): TurnExecutorId | null {
  const delegated = String(execResult?.delegatedTo_s ?? execResult?.delegatedTo ?? "").trim();
  if (delegated === "odometro") return "odometro";
  if (delegated === "certificados") return "certificados";
  if (
    failedExecutor === "mantenimiento" &&
    (looksLikeExplicitOdometerUpdateRequest(selectionText) ||
      looksLikeHorometerOnlyIntent(selectionText))
  ) {
    return "odometro";
  }
  if (looksLikeCertificateRequest(selectionText)) return "certificados";
  if (
    certificateFlowState(threadText) === "awaiting_unit" &&
    looksLikeFleetUnitSearchInput(selectionText)
  ) {
    return "certificados";
  }
  if (
    failedExecutor === "odometro" &&
    threadHasActiveOdometerFlow(threadText) &&
    !threadOdometerRegistrationCompleted(threadText)
  ) {
    return null;
  }
  if (looksLikeGpsOrUnitStatusQuestion(selectionText)) return "unidades";
  if (looksLikeLiveUnitConsultIntent(selectionText)) return "unidades";
  if (looksLikeExplicitReclamoOrTicketRequest(selectionText)) return "odoo_ticket";
  if (failedExecutor === "info_guides") return null;
  return null;
}

/** BBC corta el HTTP a los 60s; los trámites con Wara suelen tardar más. */
export function shouldDeferTurnExecutor(): boolean {
  const raw = process.env.WARA_TURN_DEFER_EXECUTOR?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export function turnExecuteUrl(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}/api/whatsapp/turn/execute`;
  const base = process.env.WARA_TURN_BASE_URL?.trim() || "https://wara.nivel41.com";
  return `${base}/api/whatsapp/turn/execute`;
}

export function scheduleDeferredTurnExecutor(params: {
  rawPhone: string;
  selectionText: string;
  apiKey: string;
}): void {
  // En Vercel un fetch fire-and-forget se cancela al terminar /turn — el cliente quedaba mudo.
  waitUntil(
    (async () => {
      try {
        const result = await runTurnExecutorPhase(params);
        if (!result.message && !result.mediaUrl) return;
        if (
          !(await shouldDeliverWhatsAppToProtectedClient(params.rawPhone, params.selectionText))
        ) {
          console.log(
            "[whatsappTurn] deferred delivery blocked for protected client",
            params.rawPhone,
          );
          return;
        }
        await sendWhatsAppTextWithOptionalMedia({
          number: params.rawPhone,
          message: result.message,
          mediaUrl: result.mediaUrl,
        });
        await persistCustomerBotReply(params.rawPhone, result.message, {
          source: "whatsapp_turn_execute",
          executor: result.executor,
          waDelivery: "backend_deferred",
        }).catch(() => undefined);
      } catch (err) {
        console.error("[whatsappTurn] deferred execute failed:", err);
        try {
          await sendWhatsAppMessage({
            number: params.rawPhone,
            message:
              "Tuve un problema procesando la consulta. Intentá de nuevo en un momento o escribí la patente/unidad con más detalle.",
          });
        } catch {
          /* último recurso */
        }
      }
    })(),
  );
}

export async function runTurnExecutorPhase(params: {
  rawPhone: string;
  selectionText: string;
  apiKey: string;
}): Promise<{ message: string; mediaUrl?: string; executor: TurnExecutorId; ok: boolean }> {
  const { rawPhone, selectionText, apiKey } = params;

  if (
    looksLikeChangeCompanyRequest(selectionText) ||
    (await looksLikeChangeCompanyRequestHybrid(selectionText))
  ) {
    const {
      resolveCustomerByWaraPhone,
      matchCompanyContinuationMention,
      extractExplicitCompanyMention,
      selectCompanyForCustomer,
      formatCompanyConfirmMessage,
      resetCustomerCompanyMenu,
    } = await import("@/lib/waraApi");
    const peek = await resolveCustomerByWaraPhone(prisma, rawPhone);
    const contacts = peek.lookup?.contactos ?? [];
    const named =
      matchCompanyContinuationMention(selectionText, contacts) ??
      extractExplicitCompanyMention(selectionText, contacts);
    // "Gracias, quiero cambiar al cacique" → cambiar YA, sin menú de opciones.
    if (named) {
      const picked = await selectCompanyForCustomer(prisma, rawPhone, {
        waraContactId: named.id,
      });
      await patchPendingActionPayload(prisma, rawPhone, {
        pivotIntent: null,
        turnLayer: {
          forkPending: false,
          lateralPause: false,
          activeExpectation: null,
          pausedExpectation: null,
        },
      }).catch(() => undefined);
      logTramitePivotTrace({ decision: "pivot_invalid_company_change", company: named.empresa });
      const companyName =
        picked.customer?.companyName?.trim() || named.empresa?.trim() || "tu empresa";
      return {
        message:
          picked.menuMessage ?? formatCompanyConfirmMessage(companyName),
        executor: "unidades",
        ok: true,
      };
    }
    const reset = await resetCustomerCompanyMenu(prisma, rawPhone);
    return { message: reset.message, executor: "unidades", ok: true };
  }

  const { resolveCustomerByWaraPhone } = await import("@/lib/waraApi");
  const waraResolution = await resolveCustomerByWaraPhone(prisma, rawPhone);
  if (!waraResolution.registered && !waraResolution.testBlocked) {
    const {
      ensureUnregisteredPhoneAdvisorHandoff,
      UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
      UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
    } = await import("@/lib/unregisteredPhoneHandoff");
    const handoff = await ensureUnregisteredPhoneAdvisorHandoff(prisma, rawPhone, {
      messageText: selectionText || undefined,
      source: "turn_executor",
    });
    return {
      message: handoff.shouldNotifyCustomer
        ? UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY
        : UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY,
      executor: "odoo_ticket",
      ok: true,
    };
  }

  const threadCtx = await loadTurnThreadContext(rawPhone, selectionText);
  let pendingAction = await getPendingAction(prisma, rawPhone);
  const thread = threadCtx.classificationThread;

  if (hasPendingOdometerActionChoice(pendingAction) && shouldSupersedeOdometerActionChoice(selectionText)) {
    await clearPendingAction(prisma, rawPhone);
    pendingAction = null;
  }

  // Cliente insiste (“Y?”) tras consulta de unidad/GPS sin respuesta útil → disculpa + asesor.
  // Bug real 2026-08-22/23: “Indícame el reporte de la nissan” → silencio → “Y?”.
  {
    const { shouldHandoffImpatientUnitConsultFollowUp, resolveConsultFailureAdvisorHandoff } =
      await import("@/lib/consultFailureHandoff");
    if (shouldHandoffImpatientUnitConsultFollowUp(selectionText, thread)) {
      const handoff = await resolveConsultFailureAdvisorHandoff(prisma, rawPhone, {
        messageText: selectionText,
        seed: rawPhone,
        source: "impatient_unit_consult_followup",
      });
      return { message: handoff.message, executor: "odoo_ticket", ok: true };
    }
  }

  // “Qué más podés hacer?” → menú de capacidades en lenguaje natural.
  // Antes del follow-up de unidad activa / caso recién abierto (bug 2026-08-23).
  // No cancela pendingAction ni activeUnit (trámite sigue en DB).
  if (looksLikeExplicitCapabilityMenuRequest(selectionText)) {
    const companyName =
      waraResolution.selectedCompanyName?.trim() ||
      waraResolution.customer?.companyName?.trim() ||
      undefined;
    return {
      message: buildAtilioHelpCapabilitiesReply(undefined, companyName),
      executor: "info_guides",
      ok: true,
    };
  }

  // Comparación/ranking entre unidades sin target concreto → límite operativo fijo.
  if (classifyFleetQueryKind(selectionText).kind === "aggregate_comparison") {
    return {
      message: buildAggregateFleetComparisonLimitReply(),
      executor: "info_guides",
      ok: true,
    };
  }

  // Cierre de conversación/caso: ANTES del agente (WARA_AGENT_MODE).
  // Bug real 2026-08-20: "Quiero resolver conversacion" tras listado de flota quedaba
  // mudo — el agente interceptaba el turno y no llegaba a /odoo/ticket.
  if (looksLikeCustomerConversationCloseRequest(selectionText)) {
    const execResult = await invokeExecutor("odoo_ticket", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    return {
      message:
        execMessage ||
        "Listo, cerré tu consulta. Gracias por escribirnos. Si necesitás algo más, quedo a disposición por este medio.",
      executor: "odoo_ticket",
      ok: execOk,
    };
  }

  const hasAiImage = selectionHasAiImageContext(selectionText);

  // Imagen sola sin descripción BBC ({aiImage}): pedir texto.
  if (looksLikeInboundMediaOnlyEvent(selectionText) && !hasAiImage) {
    return {
      message: NO_IMAGE_ANALYSIS_REPLY,
      executor: "info_guides",
      ok: true,
    };
  }

  // Visión con candidato de unidad → telemetría primero (no ticket directo).
  if (
    hasAiImage &&
    (shouldRouteGpsConsultToUnidades(selectionText) ||
      extractUnitCandidatesFromVisionText(selectionText).length > 0)
  ) {
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    return {
      message:
        execMessage ||
        "Reviso el estado GPS de la unidad y te respondo en un momento.",
      executor: "unidades",
      ok: execOk,
    };
  }

  // Texto + "adjunto imagen" con unidad identificable → telemetría antes que asesor.
  if (
    looksLikeCustomerImageAttachmentCue(selectionText) &&
    shouldRouteGpsConsultToUnidades(selectionText)
  ) {
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    return {
      message:
        execMessage ||
        "Reviso el estado GPS de la unidad y te respondo en un momento.",
      executor: "unidades",
      ok: execOk,
    };
  }

  // Texto + "adjunto imagen" / error GPS etapas sin unidad → asesor.
  // Si ya hay {aiImage} en el turno, no digas que no podés leer la captura.
  // Fuera de alcance + imagen → panel Wara solamente (sin Odoo).
  if (
    looksLikeCustomerImageAttachmentCue(selectionText) &&
    looksLikeOutOfScopeSupportClaim(selectionText)
  ) {
    const { resolveOutOfScopePlatformHandoff } = await import("@/lib/advisorHandoff");
    const handoff = await resolveOutOfScopePlatformHandoff(prisma, rawPhone, {
      messageText: selectionText,
      seed: rawPhone,
      source: "turn_executor_out_of_scope_image",
    });
    return {
      message: hasAiImage ? handoff.message : withNoImageAnalysisNotice(handoff.message),
      executor: "odoo_ticket",
      ok: true,
    };
  }
  if (
    looksLikeCustomerImageAttachmentCue(selectionText) &&
    (looksLikeGpsFeatureIssueForAdvisor(selectionText) ||
      looksLikeExplicitReclamoOrTicketRequest(selectionText) ||
      looksLikeTechnicalSupportRequest(selectionText) ||
      looksLikeHumanAdvisorRequest(selectionText))
  ) {
    const execResult = await invokeExecutor("odoo_ticket", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    const base =
      execMessage ||
      "Anoté el reclamo. Un asesor de Atención al cliente lo va a revisar.";
    return {
      message: hasAiImage ? base : withNoImageAnalysisNotice(base),
      executor: "odoo_ticket",
      ok: execOk,
    };
  }

  // Solo avisa adjunto sin detalle y sin {aiImage} → pedir texto.
  if (
    !hasAiImage &&
    looksLikeCustomerImageAttachmentCue(selectionText) &&
    !looksLikeSubstantiveCustomerMessage(
      selectionText.replace(/\b(adjunto|imagen|imagenes|captura|foto|fotos)\b/gi, " "),
    )
  ) {
    return {
      message: NO_IMAGE_ANALYSIS_REPLY,
      executor: "info_guides",
      ok: true,
    };
  }

  // Cancelación explícita en cualquier servicio con trámite inconcluso.
  if (looksLikeTramiteCancellationIntent(selectionText)) {
    const inconclusive = threadHasInconclusiveTramite(thread, pendingAction);
    const unitPickReject =
      looksLikeUnitRejection(selectionText) && threadHasOdometerUnitClarificationPending(thread);
    if (inconclusive && !unitPickReject) {
      await clearPendingAction(prisma, rawPhone);
      return {
        message: buildTramiteCancellationReply(thread, pendingAction),
        executor: "info_guides",
        ok: true,
      };
    }
    if (
      !inconclusive &&
      /^(cancelar|cancela|cancelalo|cancelala|anular|salir)$/i.test(selectionText.trim())
    ) {
      return {
        message: "No tenés ningún trámite pendiente. ¿En qué te ayudo?",
        executor: "info_guides",
        ok: true,
      };
    }
  }

  // Autoridad DB + precedencia general (antes de ramas legacy derivadas del hilo).
  // Solo `normal_route` continúa al router / pendingKind / certificateFlowState de hilo.
  if (isPendingWriteActionType(pendingAction?.type)) {
    const classified = classifyOperationPrecedence({
      pendingAction,
      selectionText,
      threadText: thread,
    });
    console.info(
      `[operationPrecedence] phone=${rawPhone.slice(0, 4)}… decision=${classified.decision} op=${classified.authority.pendingOperation} exp=${classified.authority.activeExpectation} field=${classified.structuredField} match=${classified.authority.incomingMatchesExpectedField} hasClarif=${classified.authority.hasPendingClarification} choice=${classified.authority.pendingClarificationChoice} openClarif=${classified.authority.incomingStructuredClarification} risk=${classified.authority.incomingActionRisk}`,
    );

    if (classified.decision === "resolve_pending_clarification") {
      const pendingClarification = readPendingClarification(pendingAction);
      const unitValue = pendingClarification?.unitRef.value ?? "";
      const choice = classified.authority.pendingClarificationChoice;
      const execId = classified.adapter?.executor ?? "odometro";

      if (!pendingClarification || !unitValue) {
        return {
          message:
            "Hubo un problema con la aclaración pendiente. ¿Querés el *estado/GPS* de una unidad o seguimos con el trámite?",
          executor: execId,
          ok: true,
        };
      }

      if (choice === "status") {
        const cleared = await patchPendingActionPayload(prisma, rawPhone, {
          turnLayer: clearClarificationRestoreExpectation(pendingAction),
        }).catch(() => false);
        if (!cleared) {
          return {
            message: buildUnitRefClarificationPersistFailureReply(unitValue),
            executor: execId,
            ok: true,
          };
        }
        const refreshed = await getPendingAction(prisma, rawPhone);
        const overlay = await executeOverlayReadKeepPending({
          rawPhone,
          selectionText: `Estado ${unitValue}`,
          apiKey,
          thread,
          pendingAction: refreshed,
          pendingKind: null,
          mode: "gps_unidades",
          unidadesExtras: { unitSearchText: unitValue },
        });
        if (overlay) return overlay;
        return {
          message: `No pude consultar el estado de *${unitValue}* ahora. El trámite sigue pendiente.`,
          executor: execId,
          ok: true,
        };
      }

      if (choice === "continue") {
        const paused = readTurnLayer(pendingAction)?.pausedExpectation;
        const cleared = await patchPendingActionPayload(prisma, rawPhone, {
          turnLayer: clearClarificationRestoreExpectation(pendingAction),
        }).catch(() => false);
        if (!cleared) {
          return {
            message: buildUnitRefClarificationPersistFailureReply(unitValue),
            executor: execId,
            ok: true,
          };
        }
        if (paused === "unit") {
          const execResult = await invokeExecutor(execId, rawPhone, unitValue, apiKey);
          const execMessage = messageFromPayload(execResult);
          const execOk = execResult.ok !== false && execResult.ok_s !== "false";
          if (execMessage || !executorSkippedSilently(execResult)) {
            return phaseFromExecResult(execResult, execMessage, execId, execOk);
          }
        }
        return {
          message: buildInconclusiveTramiteResumePrompt(thread, pendingAction),
          executor: execId,
          ok: true,
        };
      }

      if (choice === "cancel") {
        const cleared = await patchPendingActionPayload(prisma, rawPhone, {
          turnLayer: clearClarificationRestoreExpectation(pendingAction),
        }).catch(() => false);
        if (!cleared) {
          return {
            message: buildUnitRefClarificationPersistFailureReply(unitValue),
            executor: execId,
            ok: true,
          };
        }
        return {
          message: buildInconclusiveTramiteResumePrompt(thread, pendingAction),
          executor: execId,
          ok: true,
        };
      }

      // ambiguous | null → repregunta conservando unitRef
      return {
        message: buildUnitReferenceClarifyReply({
          referent: "vehicle_unit",
          confidence: 0.9,
          clarifyQuestion: null,
          action: "unit_reference",
          unitRef: {
            kind: pendingClarification.unitRef.kind as
              | "full_plate"
              | "prefix"
              | "suffix"
              | "brand"
              | "unit_name"
              | "none",
            value: unitValue,
          },
        }),
        executor: execId,
        ok: true,
      };
    }

    if (classified.decision === "continue_expected_field" && classified.adapter) {
      const layer = readTurnLayer(pendingAction);
      if (!layer?.activeExpectation && classified.authority.activeExpectation) {
        await patchPendingActionPayload(prisma, rawPhone, {
          stage:
            typeof pendingAction?.payload?.stage === "string"
              ? pendingAction.payload.stage
              : "collecting",
          turnLayer: {
            activeExpectation: classified.authority.activeExpectation,
          },
        }).catch(() => false);
      }
      const execResult = await invokeExecutor(
        classified.adapter.executor,
        rawPhone,
        selectionText,
        apiKey,
      );
      const execMessage = messageFromPayload(execResult);
      const execOk = execResult.ok !== false && execResult.ok_s !== "false";
      if (execMessage || !executorSkippedSilently(execResult)) {
        return phaseFromExecResult(
          execResult,
          execMessage,
          classified.adapter.executor,
          execOk,
        );
      }
      return {
        message:
          execMessage ||
          "Seguimos con el trámite en curso. ¿Me pasás el dato que falta?",
        executor: classified.adapter.executor,
        ok: execOk,
      };
    } else if (classified.decision === "overlay_read_keep_pending") {
      const overlay = await executeOverlayReadKeepPending({
        rawPhone,
        selectionText,
        apiKey,
        thread,
        pendingAction,
        pendingKind: null,
        mode: "gps_unidades",
        prepareStatusPivot: true,
      });
      if (overlay) return overlay;
    } else if (classified.decision === "fork_incompatible_write") {
      return openIncompatibleWriteForkOrSafeReply({
        rawPhone,
        thread,
        pendingAction,
        pendingOperation: classified.authority.pendingOperation,
        pausedExpectation: classified.authority.activeExpectation,
        executor: classified.adapter?.executor ?? executorFromPendingAction(pendingAction),
      });
    } else if (classified.decision === "structured_clarification") {
      // Apertura de aclaración NUEVA (no hay XOR pendiente en DB).
      const clarifExecutor =
        classified.adapter?.executor ?? executorFromPendingAction(pendingAction);
      if (classified.structuredField === "unit_ref") {
        const unitValue = selectionText.trim();
        return persistUnitRefClarificationOrSafeReply({
          rawPhone,
          thread,
          pendingAction,
          understanding: {
            referent: "vehicle_unit",
            confidence: 0.9,
            clarifyQuestion: null,
            action: "unit_reference",
            unitRef: { kind: "unit_name", value: unitValue },
          },
          unitKind: "unit_name",
          unitValue,
          executor: clarifExecutor,
        });
      }
      return {
        message:
          "Tomé tu mensaje, pero necesito aclarar si es dato del trámite en curso o una consulta aparte (por ejemplo estado/GPS).",
        executor: clarifExecutor,
        ok: true,
      };
    }
    // normal_route → legacy abajo
  }

  // Retomar trámite inconcluso (sin CONFIRMO): preguntar antes de continuar.
  // No interceptar si hay fork_choice XOR pendiente (menú cambiar vs seguir).
  if (
    looksLikeResumeInconclusiveTramite(selectionText) &&
    threadHasInconclusiveTramite(thread, pendingAction) &&
    !detectPendingConfirmKind(thread) &&
    !isTurnLayerForkPending(pendingAction)
  ) {
    const executor = resolveExecutorForInconclusiveTramite(thread, pendingAction);
    return {
      message: buildInconclusiveTramiteResumePrompt(thread, pendingAction),
      executor,
      ok: true,
    };
  }

  // CONFIRMO pendiente + "No"/rechazo: la IA razona (¿cancelar? ¿era consulta? ¿corregir unidad?).
  // Nunca asumir "no era esa patente" sin razonar el contexto del resumen.
  const pendingKind = detectPendingConfirmKind(thread);

  // Trámite ya cerrado + "Genial"/"joya"/"gracias" → cierre social, no reabrir CONFIRMO.
  if (
    (looksLikeConversationAcknowledgement(selectionText) ||
      looksLikeColloquialGratitudeAck(selectionText)) &&
    (threadHasRecentCertificateSuccess(thread) ||
      threadHasRecentMaintenanceSuccess(thread) ||
      threadOdometerRegistrationCompleted(thread))
  ) {
    return {
      message: "De nada. ¿En qué más te ayudo?",
      executor: "info_guides",
      ok: true,
    };
  }

  // Consulta lateral ya respondida: "ah entiendo" / "continuamos porfa" debe retomar
  // el CONFIRMO, no silenciar ni registrar como si hubiera dicho CONFIRMO.
  if (
    pendingKind &&
    (looksLikeResumePausedTramite(selectionText) ||
      looksLikePendingConfirmComprehensionAck(selectionText))
  ) {
    const reminder = buildPendingConfirmStillWaitingReminder(pendingKind);
    const prefix = looksLikeResumePausedTramite(selectionText) ? "Dale, seguimos. " : "Dale. ";
    return {
      message: `${prefix}${reminder}`,
      executor:
        pendingKind === "odometro"
          ? "odometro"
          : pendingKind === "certificados"
            ? "certificados"
            : "mantenimiento",
      ok: true,
    };
  }
  // "como puedo hacer?" / "no entiendo" con CONFIRMO pendiente: explicar el paso,
  // no pisar el detalle ni saltar a otro trámite.
  if (pendingKind && looksLikePendingConfirmHelpOrConfusion(selectionText)) {
    return {
      message: buildPendingConfirmHelpReply(pendingKind),
      executor:
        pendingKind === "odometro"
          ? "odometro"
          : pendingKind === "certificados"
            ? "certificados"
            : "mantenimiento",
      ok: true,
    };
  }
  if (pendingKind === "certificados" && looksLikeCertificateUnitPivot(selectionText)) {
    const execResult = await invokeExecutor("certificados", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "certificados", ok: execOk };
    }
  }

  // Bifurcación pivot / lateral (fork_choice en DB o hilo) — antes que laterales tipadas.
  if (threadAwaitingTramiteForkChoice(thread) || isTurnLayerForkPending(pendingAction)) {
    const fork = classifyPivotForkChoiceResponse(selectionText);
    const isHoro =
      threadAwaitingHorometerKmValue(thread) ||
      /\bhor[oó]metro\b/i.test(thread.slice(-1200));
    const pivotForFork = readPivotIntent(pendingAction);
    if (fork === "resume") {
      const resumePatch = buildResumeTurnLayerPatch(pendingAction);
      await patchPendingActionPayload(prisma, rawPhone, {
        turnLayer: resumePatch,
        pivotIntent: null,
      }).catch(() => undefined);
      logTramitePivotTrace({
        decision: "fork_resume_tramite",
        restoredExpectation: resumePatch.activeExpectation,
        pivot: pivotForFork?.unitRef?.value,
      });
      return {
        message: buildInconclusiveTramiteResumePrompt(thread, pendingAction),
        executor: resolveExecutorForInconclusiveTramite(thread, pendingAction),
        ok: true,
      };
    }
    if (fork === "switch") {
      const pivot = pivotForFork;
      if (pivot) {
        logTramitePivotTrace({
          decision: "fork_switch_consult",
          pivot: pivot.unitRef.value,
          originalText: pivot.originalText,
        });
        await clearPendingAction(prisma, rawPhone);
        const execResult = await invokeExecutor("unidades", rawPhone, pivot.originalText, apiKey);
        const execMessage = messageFromPayload(execResult);
        const execOk = execResult.ok !== false && execResult.ok_s !== "false";
        return {
          message: execMessage,
          executor: "unidades",
          ok: execOk,
        };
      }
      await clearPendingAction(prisma, rawPhone);
      const other = looksLikeExplicitOtherTramiteIntent(selectionText);
      if (other === "mantenimiento") {
        const execResult = await invokeExecutor(
          "mantenimiento",
          rawPhone,
          selectionText,
          apiKey,
        );
        const execMessage = messageFromPayload(execResult);
        const execOk = execResult.ok !== false && execResult.ok_s !== "false";
        return {
          message: execMessage,
          executor: "mantenimiento",
          ok: execOk,
        };
      }
      if (other === "certificados") {
        const execResult = await invokeExecutor("certificados", rawPhone, selectionText, apiKey);
        const execMessage = messageFromPayload(execResult);
        const execOk = execResult.ok !== false && execResult.ok_s !== "false";
        return {
          message: execMessage,
          executor: "certificados",
          ok: execOk,
        };
      }
      if (
        looksLikeHorometerOnlyIntent(selectionText) ||
        looksLikeBareHorometerTopicMention(selectionText) ||
        looksLikeExplicitOdometerUpdateRequest(selectionText) ||
        looksLikeBareOdometerTopicMention(selectionText)
      ) {
        const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
        const execMessage = messageFromPayload(execResult);
        const execOk = execResult.ok !== false && execResult.ok_s !== "false";
        return {
          message: execMessage,
          executor: "odometro",
          ok: execOk,
        };
      }
      return {
        message:
          "Dale, cambiamos de requerimiento. ¿Querés *mantenimiento*, *certificado*, consultar el *estado de una unidad* u otra cosa?",
        executor: "info_guides",
        ok: true,
      };
    }
    if (fork === "ambiguous") {
      return {
        message: pivotForFork
          ? buildPivotForkClarificationReply(thread)
          : buildTramiteForkClarificationReply(isHoro),
        executor: "odometro",
        ok: true,
      };
    }
  }

  // Política central read/write: metadata estructurada → interferencia.
  // prepareStatusPivotDuringTramite ya no abre fork por lectura GPS.
  // (pendingClarification XOR se resuelve solo en el gate operationPrecedence arriba).
  const hasPendingWrite =
    isPendingWriteActionType(pendingAction?.type) ||
    (threadHasActiveOdometerFlow(thread) && !threadOdometerRegistrationCompleted(thread)) ||
    Boolean(pendingKind);
  const incomingMatchesExpectedField = shouldSkipTypedLateralForOdometerFlow(
    selectionText,
    thread,
  );
  const typedLateralKind = classifyTypedLateralQuery(selectionText);
  let incomingActionRisk: ActionWriteRisk | null = actionRiskFromTypedLateralKind(typedLateralKind);
  if (!incomingActionRisk && isExplicitUnitStatusQuery(selectionText)) {
    incomingActionRisk = "read";
  }
  if (!incomingActionRisk) {
    const otherWrite = looksLikeExplicitOtherTramiteIntent(selectionText);
    if (otherWrite) incomingActionRisk = "write";
    else if (
      looksLikeHorometerOnlyIntent(selectionText) ||
      looksLikeBareHorometerTopicMention(selectionText) ||
      looksLikeExplicitOdometerUpdateRequest(selectionText) ||
      looksLikeBareOdometerTopicMention(selectionText)
    ) {
      // Solo si el pending no es el mismo medidor en recolección esperada —
      // el match de campo esperado tiene prioridad en la policy.
      if (hasPendingWrite && !incomingMatchesExpectedField) {
        incomingActionRisk = "write";
      }
    }
  }

  if (hasPendingWrite && incomingActionRisk) {
    const interference = decidePendingWriteInterference({
      hasPendingWrite: true,
      incomingActionRisk,
      incomingMatchesExpectedField,
    });

    if (interference === "overlay_read_keep_pending") {
      const isGpsRead =
        typedLateralKind === "gps_unit_status" || isExplicitUnitStatusQuery(selectionText);
      const overlay = await executeOverlayReadKeepPending({
        rawPhone,
        selectionText,
        apiKey,
        thread,
        pendingAction,
        pendingKind,
        mode: isGpsRead ? "gps_unidades" : "typed_lateral",
        typedLateralKind,
        prepareStatusPivot: isGpsRead,
      });
      if (overlay) return overlay;
    }

    if (interference === "fork_incompatible_write" && !pendingKind) {
      // Fork solo write/write. El builder de fork de GPS ya no aplica a lecturas.
      const tramiteUnit = extractTramiteUnitAnchorFromThread(thread);
      const other = looksLikeExplicitOtherTramiteIntent(selectionText);
      if (tramiteUnit && other) {
        return openIncompatibleWriteForkOrSafeReply({
          rawPhone,
          thread,
          pendingAction,
          pendingOperation:
            pendingAction?.type === "certificados"
              ? "certificados"
              : pendingAction?.type === "mantenimiento"
                ? "mantenimiento"
                : "meter_odometro",
          pausedExpectation: readTurnLayer(pendingAction)?.activeExpectation ?? null,
          executor: executorFromPendingAction(pendingAction),
          message: [
            `Estás con un trámite en curso de *${tramiteUnit.displayLabel}*.`,
            `Pediste *${other === "certificados" ? "certificado" : "mantenimiento"}*.`,
            "",
            "¿Qué preferís?",
            "• *Cambiar de requerimiento* — dejamos el trámite actual y arrancamos el nuevo.",
            "• *Seguir con el trámite* — terminamos lo pendiente primero.",
          ].join("\n"),
        });
      }
    }
  }

  // Laterales tipadas sin escritura pendiente (o continue_expected_field cae al routing normal).
  if (
    typedLateralKind &&
    tramiteAllowsTypedLateralOverlay(thread, pendingAction) &&
    !shouldSkipTypedLateralForOdometerFlow(selectionText, thread)
  ) {
    const interference = decidePendingWriteInterference({
      hasPendingWrite,
      incomingActionRisk: "read",
      incomingMatchesExpectedField: false,
    });
    if (interference === "overlay_read_keep_pending") {
      const overlay = await executeOverlayReadKeepPending({
        rawPhone,
        selectionText,
        apiKey,
        thread,
        pendingAction,
        pendingKind,
        mode: typedLateralKind === "gps_unit_status" ? "gps_unidades" : "typed_lateral",
        typedLateralKind,
      });
      if (overlay) return overlay;
    }
    if (interference === "normal_route") {
      let lateralBody: string;
      let lateralOk = true;
      if (typedLateralKind === "gps_unit_status") {
        const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
        lateralBody = messageFromPayload(execResult);
        lateralOk = execResult.ok !== false && execResult.ok_s !== "false";
        if (!lateralBody) {
          lateralBody =
            "No pude consultar el estado GPS ahora. Si querés, repetí la consulta con patente o interno.";
          lateralOk = false;
        }
      } else {
        lateralBody = await buildTypedLateralReply(
          prisma,
          rawPhone,
          typedLateralKind,
          selectionText,
        );
      }
      return {
        message: lateralBody,
        executor: typedLateralKind === "gps_unit_status" ? "unidades" : "info_guides",
        ok: lateralOk,
      };
    }
  }

  if (pendingKind && looksLikePendingConfirmPushback(selectionText, pendingKind)) {
    const stance = await reasonPendingConfirmationRejection({
      selectionText,
      threadText: thread,
      kind: pendingKind,
    });

    if (stance.action === "unclear") {
      return {
        message:
          stance.clarify ||
          "No te seguí del todo. ¿Querés cancelar este registro, corregir la unidad, o era otra consulta?",
        executor: "info_guides",
        ok: true,
      };
    }

    if (stance.action === "correct_unit") {
      if (pendingKind === "odometro") {
        const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
        const execMessage = messageFromPayload(execResult);
        const execOk = execResult.ok !== false && execResult.ok_s !== "false";
        if (execMessage || !executorSkippedSilently(execResult)) {
          return { message: execMessage, executor: "odometro", ok: execOk };
        }
      }
      if (pendingKind === "certificados") {
        const execResult = await invokeExecutor("certificados", rawPhone, selectionText, apiKey);
        const execMessage = messageFromPayload(execResult);
        const execOk = execResult.ok !== false && execResult.ok_s !== "false";
        if (execMessage || !executorSkippedSilently(execResult)) {
          return { message: execMessage, executor: "certificados", ok: execOk };
        }
      }
      return {
        message:
          stance.clarify ||
          "Entendido. ¿Cuál es la patente o unidad correcta? Pasame la matrícula o la marca/nombre.",
        executor: pendingKind === "mantenimiento" ? "mantenimiento" : "unidades",
        ok: true,
      };
    }

    // Consulta/dato del mismo tema ANTES de confirmar: NO borrar el pending.
    if (stance.action === "pause_for_side_query") {
      const reminder = buildPendingConfirmStillWaitingReminder(pendingKind);
      const query = stance.query?.trim();
      if (query) {
        const execResult = await invokeExecutor("unidades", rawPhone, query, apiKey);
        const execMessage = messageFromPayload(execResult);
        const execOk = execResult.ok !== false && execResult.ok_s !== "false";
        if (execMessage) {
          return {
            message: `${execMessage}\n\n${reminder}`,
            executor: "unidades",
            ok: execOk,
          };
        }
      }
      return {
        message:
          stance.clarify ||
          `Dale, el registro queda pendiente. ¿Qué dato necesitás antes de confirmar?\n\n${reminder}`,
        executor: "info_guides",
        ok: true,
      };
    }

    // cancel_tramite | cancel_and_resume_query
    await clearPendingAction(prisma, rawPhone);

    if (stance.action === "cancel_and_resume_query") {
      const query =
        stance.query?.trim() ||
        (pendingKind === "mantenimiento"
          ? extractPendingMaintenanceDetalle(thread)
          : null) ||
        selectionText;
      const execResult = await invokeExecutor("unidades", rawPhone, query, apiKey);
      const execMessage = messageFromPayload(execResult);
      const execOk = execResult.ok !== false && execResult.ok_s !== "false";
      if (execMessage) {
        return {
          message: `Listo, no registro ese trámite.\n\n${execMessage}`,
          executor: "unidades",
          ok: execOk,
        };
      }
    }

    if (pendingKind === "odometro") {
      const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
      const execMessage = messageFromPayload(execResult);
      const execOk = execResult.ok !== false && execResult.ok_s !== "false";
      if (execMessage || !executorSkippedSilently(execResult)) {
        return { message: execMessage, executor: "odometro", ok: execOk };
      }
    }
    if (pendingKind === "certificados") {
      const execResult = await invokeExecutor("certificados", rawPhone, selectionText, apiKey);
      const execMessage = messageFromPayload(execResult);
      const execOk = execResult.ok !== false && execResult.ok_s !== "false";
      if (execMessage || !executorSkippedSilently(execResult)) {
        return { message: execMessage, executor: "certificados", ok: execOk };
      }
    }

    return {
      message:
        pendingKind === "mantenimiento"
          ? "Entendido, no registro ese mantenimiento. ¿En qué más te puedo ayudar? Podés pedirme odómetro, horómetro, certificado o consultar el estado de una unidad."
          : "Entendido, cancelé ese paso. ¿En qué más te ayudo?",
      executor: "info_guides",
      ok: true,
    };
  }

  // "No" / rechazo de unidad: solo si el hilo recién pidió aclarar patente/unidad.
  // El resto de negaciones las razona la IA (pending CONFIRMO ya se manejó arriba).
  if (
    (looksLikeUnitRejection(selectionText) || looksLikeBareNegativeResponse(selectionText)) &&
    (threadHasOdometerUnitClarificationPending(thread) ||
      threadHasRecentUnitProblemListenPrompt(thread) ||
      /encontr[eé] varias|cu[aá]l (es|quer[eé]s)|patente exacta|no era esa/i.test(
        thread.slice(-1200),
      ))
  ) {
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return phaseFromExecResult(execResult, execMessage, "unidades", execOk);
    }
  }

  // Pedido de operador / mesa / cierre → Odoo ANTES que utterance IA
  // (bug real 2026-08-06: "comunicame a mesa de entrada" → pedía patente).
  // Fuera de alcance: SOLO panel Wara (sin Odoo) + mensaje natural + pausa bot.
  if (looksLikeOutOfScopeSupportClaim(selectionText)) {
    const { resolveOutOfScopePlatformHandoff } = await import("@/lib/advisorHandoff");
    const handoff = await resolveOutOfScopePlatformHandoff(prisma, rawPhone, {
      messageText: selectionText,
      seed: rawPhone,
      source: "turn_executor_out_of_scope",
    });
    return { message: handoff.message, executor: "odoo_ticket", ok: true };
  }
  if (
    looksLikeHumanAdvisorRequest(selectionText) ||
    looksLikeTechnicalSupportRequest(selectionText) ||
    looksLikeExplicitReclamoOrTicketRequest(selectionText) ||
    looksLikeCustomerConversationCloseRequest(selectionText)
  ) {
    const execResult = await invokeExecutor("odoo_ticket", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odoo_ticket", ok: execOk };
    }
  }

  // Valor numérico (km/hs) con patente ya confirmada → odómetro, antes que confirmaciones stale.
  const meterValuePendingFromDb =
    pendingAction?.type === "odometro" &&
    !!pendingAction.payload?.patente &&
    !hasPendingOdometerConfirmation(threadCtx.classificationThread);
  if (
    looksLikeBareMeterValue(selectionText) &&
    (threadHasActiveMeterValueRequest(threadCtx.classificationThread) || meterValuePendingFromDb)
  ) {
    if (pendingAction?.type === "mantenimiento") {
      await clearPendingAction(prisma, rawPhone);
    }
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
  }

  // Confirmación de trámite: el backend registra con los datos guardados — no dejar que
  // la IA reinterprete "Confirmo" / "esa está bien" (seguridad operativa).
  if (
    hasAnyPendingConfirmation(threadCtx.classificationThread) &&
    classifyConfirmoPhrase(selectionText) === "clarify"
  ) {
    return {
      message: buildConfirmoClarifyReply(),
      executor:
        pendingKind === "odometro"
          ? "odometro"
          : pendingKind === "certificados"
            ? "certificados"
            : pendingKind === "mantenimiento"
              ? "mantenimiento"
              : "info_guides",
      ok: true,
    };
  }

  const pendingConfirmExecutor = resolvePendingConfirmationExecutor(
    threadCtx.classificationThread,
    selectionText,
  );
  const pendingTramiteType =
    pendingAction?.type === "odometro" ||
    pendingAction?.type === "certificados" ||
    pendingAction?.type === "mantenimiento"
      ? pendingAction.type
      : null;
  if (
    looksLikePendingTramiteAffirmation(selectionText) &&
    (pendingConfirmExecutor || (pendingTramiteType && pendingAction?.payload))
  ) {
    // Thread CONFIRMO (cert/odo) manda sobre pendingAction stale de mantenimiento.
    const executor =
      pendingConfirmExecutor ??
      (hasPendingCertificateConfirmation(threadCtx.classificationThread)
        ? "certificados"
        : hasPendingOdometerConfirmation(threadCtx.classificationThread)
          ? "odometro"
          : pendingTramiteType!);
    const execResult = await invokeExecutor(executor, rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage) {
      return { message: execMessage, executor, ok: execOk };
    }
    // Nunca silencio ante CONFIRMO: si el executor no devolvió texto, igual contestamos.
    return {
      message:
        "Tengo el registro pendiente pero no pude cerrarlo ahora. Respondé CONFIRMO de nuevo o decime qué corregir.",
      executor,
      ok: false,
    };
  }

  // Confirmación en odómetro solo si hay resumen CONFIRMO / pending real (no "sí" genérico mid-flujo).
  if (
    (looksLikePendingTramiteAffirmation(selectionText) ||
      looksLikeBriefConfirmation(selectionText)) &&
    (pendingConfirmExecutor ||
      (pendingTramiteType === "odometro" && pendingAction?.payload) ||
      resolvePendingConfirmationExecutor(threadCtx.classificationThread, "CONFIRMO") ===
        "odometro") &&
    threadHasActiveOdometerFlow(threadCtx.classificationThread) &&
    !threadOdometerRegistrationCompleted(threadCtx.classificationThread)
  ) {
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
  }

  if (
    looksLikeServiceScopeConsultationMeta(selectionText) &&
    !pendingConfirmExecutor &&
    !pendingAction?.payload
  ) {
    return {
      message: buildBriefServiceScopeConsultationReply(),
      executor: "unidades",
      ok: true,
    };
  }

  // Trámite de certificado esperando unidad: antes que interpretación IA / GPS.
  if (
    shouldContinueCertificateUnitCollection(selectionText, threadCtx.classificationThread, pendingAction) &&
    !looksLikeBriefConfirmation(selectionText)
  ) {
    const execResult = await invokeExecutor("certificados", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "certificados", ok: execOk };
    }
  }

  // Listado de flota ANTES de la IA: "listame las unidades" no debe pedir matrícula.
  if (
    await shouldRouteTurnToFleetListExecutorHybrid({
      selectionText,
      threadText: threadCtx.classificationThread,
    })
  ) {
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage) {
      return phaseFromExecResult(execResult, execMessage, "unidades", execOk);
    }
  }

  // Consulta lateral durante odómetro activo (antes que datos operativos / utterance IA).
  const odometerSideQuestion = classifyOdometerFlowSideQuestion(
    selectionText,
    threadCtx.classificationThread,
  );
  if (odometerSideQuestion) {
    // Legacy estricto odómetro/horómetro: no contaminar cert/maint.
    if (pendingAction?.type === "odometro" || !pendingAction) {
      await ensureOdometerCollectingTurnLayer(
        prisma,
        rawPhone,
        threadCtx.classificationThread,
        buildCollectingPayloadForFork(
          threadCtx.classificationThread,
          pendingAction?.payload,
        ),
      );
    } else {
      await ensurePendingOperationForkLayer({
        prisma,
        phone: rawPhone,
        pendingAction,
        pausedExpectation: readTurnLayer(pendingAction)?.activeExpectation ?? null,
        threadText: threadCtx.classificationThread,
      });
    }
    return {
      message: buildOdometerFlowSideQuestionReply(
        odometerSideQuestion,
        threadCtx.classificationThread,
        selectionText,
      ),
      executor: "odometro",
      ok: true,
    };
  }

  // Odómetro/horómetro activo: interno/unidad/patente/km → executor.
  if (
    shouldRouteTurnToOdometerExecutor({
      selectionText,
      threadText: threadCtx.classificationThread,
      pendingActionType: pendingAction?.type ?? null,
    })
  ) {
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
  }

  // ——— IA primero (casi todo el diálogo) ———
  // Reglas operativas solo ejecutan después, según la intención entendida.
  let skipSchematicUnitRoute = false;
  let lastUnderstanding: UtteranceUnderstanding | null = null;
  let aiUnitExtras:
    | {
        platePrefix?: string;
        plate?: string;
        unitSearchText?: string;
        utteranceAction?: string;
      }
    | undefined;
  const activeUnitForNl = await getActiveUnit(prisma, rawPhone);
  const sessionNotebookForNl = await getSessionNotebook(prisma, rawPhone).catch(() => null);
  const persistedContextPlate = resolveContextUnitPlate({
    sessionNotebook: sessionNotebookForNl,
    activeUnitPlate: activeUnitForNl?.plate,
  });
  const hasPersistedContextUnit = !!persistedContextPlate;
  const threadAwaitingUnitProblem = threadHasRecentUnitProblemListenPrompt(
    threadCtx.classificationThread,
  );
  // Pivot a otra unidad: limpiar contexto — excepto certificado en CONFIRMO (sigue en certificados).
  if (looksLikeAnotherUnitConsultRequest(selectionText)) {
    if (
      hasPendingCertificateConfirmation(threadCtx.classificationThread) &&
      looksLikeCertificateUnitPivot(selectionText)
    ) {
      const execResult = await invokeExecutor("certificados", rawPhone, selectionText, apiKey);
      const execMessage = messageFromPayload(execResult);
      const execOk = execResult.ok !== false && execResult.ok_s !== "false";
      if (execMessage || !executorSkippedSilently(execResult)) {
        return { message: execMessage, executor: "certificados", ok: execOk };
      }
    }
    await clearActiveUnit(prisma, rawPhone).catch(() => {});
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return phaseFromExecResult(execResult, execMessage, "unidades", execOk);
    }
  }
  if (shouldInterpretAmbiguousUtterance(selectionText, threadCtx.classificationThread)) {
    const understanding = await understandUserUtterance(
      selectionText,
      threadCtx.classificationThread,
    );
    lastUnderstanding = understanding;

    // Unidad reconocida sin action de lectura → aclarar; XOR con pendingClarification+unitRef.
    if (hasPendingWrite && shouldClarifyUnitWithoutStatusAction(understanding)) {
      const unitRef = understanding!.unitRef!;
      const unitValue = String(unitRef.value ?? "").trim();
      if (!unitValue) {
        return {
          message: buildUnitReferenceClarifyReply(understanding),
          executor: executorFromPendingAction(pendingAction),
          ok: true,
        };
      }
      console.info(
        `[utteranceUnderstanding] clarify-unit-no-status-action phone=${rawPhone.slice(0, 4)}… action=${understanding?.action}`,
      );
      return persistUnitRefClarificationOrSafeReply({
        rawPhone,
        thread,
        pendingAction,
        understanding,
        unitKind: unitRef.kind,
        unitValue,
        executor: executorFromPendingAction(pendingAction),
      });
    }

    const aiHint = unitSearchHintFromUnderstanding(understanding);
    const plateInMsg = detectLoosePlate(selectionText);
    const regexPlateOk =
      !!plateInMsg && isPlausibleVehiclePlate(normalizePlate(plateInMsg));
    const regexPrefix = extractPlatePrefixFromMessage(selectionText);
    const explicitUnitCode = extractExplicitUnitNameFromText(selectionText);
    const movilIdClassic = extractMovilIdFromUnitMessage(selectionText, {
      threadText: threadCtx.classificationThread,
    });
    // Bajo unit_status_read: interno embebido (900118) es entidad del mensaje — no reusar activeUnit.
    const movilIdStatusRead = movilIdFromMessageUnderStatusRead({
      utteranceAction: understanding?.action,
      rawText: selectionText,
    });
    const movilIdFromMsg = movilIdClassic ?? movilIdStatusRead;
    // unit_ref LLM (plate/prefix arriba); interno/código del mensaje gana sobre marca libre IA.
    const freeName =
      explicitUnitCode ||
      (movilIdFromMsg != null ? String(movilIdFromMsg) : null) ||
      aiHint?.unitName ||
      aiHint?.brand ||
      extractFreeTextUnitSearchCandidate(selectionText) ||
      null;
    // Reglas determinísticas primero; IA solo completa lo que el texto no pudo extraer.
    const hasUsablePlate = regexPlateOk || !!aiHint?.plate;
    const prefixHint = regexPrefix ?? aiHint?.platePrefix ?? null;
    const hasUsablePrefix = !!prefixHint;
    const hasUsableName = !!freeName;
    const hasUsableMovilId = movilIdFromMsg != null;
    const hasClassicUnitInMessage =
      hasUsablePlate || hasUsablePrefix || hasUsableName || hasUsableMovilId;
    // Candidato de formato admitido bajo status_read bloquea reuso aunque aún no haya match.
    const hasUsableUnitInMessage = hasStatusReadMessageUnitEntity({
      utteranceAction: understanding?.action,
      rawText: selectionText,
      hasUsableUnitInMessage: hasClassicUnitInMessage,
    });
    aiUnitExtras = {
      ...(prefixHint ? { platePrefix: prefixHint } : {}),
      ...(!regexPlateOk && aiHint?.plate ? { plate: aiHint.plate } : {}),
      ...(freeName ? { unitSearchText: freeName } : {}),
      ...(understanding?.action ? { utteranceAction: understanding.action } : {}),
    };
    if (
      !aiUnitExtras.platePrefix &&
      !aiUnitExtras.plate &&
      !aiUnitExtras.unitSearchText &&
      !aiUnitExtras.utteranceAction
    ) {
      aiUnitExtras = undefined;
    }

    const reuseContextUnit = canReuseContextUnitForTurn({
      utteranceAction: understanding?.action,
      unitRefKind: understanding?.unitRef?.kind,
      hasUsableUnitInMessage,
      hasPersistedContextUnit,
    });
    // Solo inyectar contexto si no hay entidad de mensaje (incluye candidato sin match aún).
    if (reuseContextUnit && !aiUnitExtras?.plate && !aiUnitExtras?.unitSearchText) {
      if (persistedContextPlate) {
        aiUnitExtras = {
          ...(aiUnitExtras ?? {}),
          plate: persistedContextPlate.replace(/\s+/g, "").toUpperCase(),
          ...(understanding?.action ? { utteranceAction: understanding.action } : {}),
        };
      }
    }

    const unitConsultMode = decideUnitConsultMode({
      utteranceAction: understanding?.action,
      unitRefKind: understanding?.unitRef?.kind,
      hasUsableUnitInMessage,
      hasPersistedContextUnit,
      listenCandidate: false,
    });

    // Si el mensaje (o la IA) ya trae patente/prefijo/nombre usable, no preguntar — ejecutar flota.
    const clarify = clarificationFromUnderstanding(understanding, selectionText);
    if (
      clarify &&
      !hasUsableUnitInMessage &&
      !reuseContextUnit &&
      !hasPersistedContextUnit &&
      !threadAwaitingUnitProblem
    ) {
      if (shouldContinueCertificateUnitCollection(selectionText, threadCtx.classificationThread, pendingAction)) {
        console.info(
          `[utteranceUnderstanding] certificado-aclarar phone=${rawPhone.slice(0, 4)}… referent=${understanding?.referent}`,
        );
        return {
          message: askCertificateUnitMessage(),
          executor: "certificados",
          ok: true,
        };
      }
      console.info(
        `[utteranceUnderstanding] aclarar phone=${rawPhone.slice(0, 4)}… referent=${understanding?.referent} conf=${understanding?.confidence}`,
      );
      return { message: clarify, executor: "info_guides", ok: true };
    }
    // Pedir matrícula: ask_unit estructurado, o vehicle_unit sin dato ni contexto persistido.
    if (
      understanding &&
      shouldProceedAsVehicleUnit(understanding) &&
      !hasUsableUnitInMessage &&
      !reuseContextUnit &&
      !hasPersistedContextUnit &&
      !isBarePlatePrefixHint(selectionText) &&
      !looksLikeFleetUnitSearchInput(selectionText) &&
      !threadAwaitingUnitProblem &&
      (unitConsultMode === "ask_unit" || understanding.action !== "unit_status_read")
    ) {
      if (shouldContinueCertificateUnitCollection(selectionText, threadCtx.classificationThread, pendingAction)) {
        console.info(
          `[utteranceUnderstanding] certificado-sin-dato phone=${rawPhone.slice(0, 4)}… referent=${understanding.referent}`,
        );
        return {
          message: askCertificateUnitMessage(),
          executor: "certificados",
          ok: true,
        };
      }
      console.info(
        `[utteranceUnderstanding] unidad-sin-dato phone=${rawPhone.slice(0, 4)}… referent=${understanding.referent} action=${understanding.action}`,
      );
      return {
        message:
          understanding.clarifyQuestion?.trim() ||
          "Dale, pasame la matrícula o el código de la unidad (ej. AD427MC, M300-097 o 600088).",
        executor: "info_guides",
        ok: true,
      };
    }
    if (
      !hasUsablePlate &&
      !hasPersistedContextUnit &&
      shouldAnswerOpenCaseFromUnderstanding(
        understanding,
        selectionText,
        threadCtx.classificationThread,
      )
    ) {
      console.info(
        `[utteranceUnderstanding] caso-abierto phone=${rawPhone.slice(0, 4)}… referent=${understanding?.referent} conf=${understanding?.confidence}`,
      );
      return {
        message: await buildOpenCaseStatusReply(rawPhone),
        executor: "odoo_ticket",
        ok: true,
      };
    }
    const keepActiveUnitThread =
      !!hasPersistedContextUnit &&
      !looksLikeAnotherUnitConsultRequest(selectionText) &&
      (reuseContextUnit ||
        threadAwaitingUnitProblem ||
        looksLikeUnitConsultFollowUp(selectionText) ||
        looksLikeUnitReportingStatusCue(selectionText) ||
        looksLikeGpsOrUnitStatusQuestion(selectionText) ||
        looksLikeLiveUnitConsultIntent(selectionText) ||
        understanding?.action === "unit_status_read" ||
        looksLikeSubstantiveCustomerMessage(selectionText));
    // Con unidad activa, NUNCA saltear flota por un referent IA raro ("new_request" en
    // "Quiero el estado"): el hilo ya tiene la patente.
    if (
      hasUsablePlate ||
      hasUsablePrefix ||
      hasUsableName ||
      keepActiveUnitThread ||
      shouldForceUnidadesFromUnderstanding(understanding)
    ) {
      skipSchematicUnitRoute = false;
      if (hasUsablePlate) {
        console.info(
          `[utteranceUnderstanding] patente-en-mensaje phone=${rawPhone.slice(0, 4)}… plate=${aiHint?.plate ?? plateInMsg} (prioriza flota)`,
        );
      } else if (hasUsablePrefix) {
        console.info(
          `[utteranceUnderstanding] prefijo-razonado phone=${rawPhone.slice(0, 4)}… prefix=${prefixHint} source=${aiHint?.platePrefix ? "ai" : "rules"} (prioriza flota)`,
        );
      } else if (hasUsableName) {
        console.info(
          `[utteranceUnderstanding] nombre-en-mensaje phone=${rawPhone.slice(0, 4)}… name=${freeName} (prioriza flota)`,
        );
      } else if (shouldForceUnidadesFromUnderstanding(understanding)) {
        console.info(
          `[utteranceUnderstanding] unidad-forzada-ia phone=${rawPhone.slice(0, 4)}… unit_ref=${understanding?.unitRef?.kind}:${understanding?.unitRef?.value}`,
        );
      } else {
        console.info(
          `[utteranceUnderstanding] contexto-unidad-persistido phone=${rawPhone.slice(0, 4)}… plate=${persistedContextPlate}`,
        );
      }

      // Solo action=unit_status_read autoriza overlay GPS. vehicle_unit solo → aclarar.
      const semanticRisk = actionRiskFromUnderstanding(understanding);
      if (hasPendingWrite && shouldClarifyUnitWithoutStatusAction(understanding)) {
        const unitRef = understanding!.unitRef!;
        const unitValue = String(unitRef.value ?? "").trim();
        console.info(
          `[utteranceUnderstanding] unit-sin-accion-read phone=${rawPhone.slice(0, 4)}… action=${understanding?.action}`,
        );
        if (!unitValue) {
          return {
            message: buildUnitReferenceClarifyReply(understanding),
            executor: executorFromPendingAction(pendingAction),
            ok: true,
          };
        }
        return persistUnitRefClarificationOrSafeReply({
          rawPhone,
          thread,
          pendingAction,
          understanding,
          unitKind: unitRef.kind,
          unitValue,
          executor: executorFromPendingAction(pendingAction),
        });
      }
      if (semanticRisk) {
        const semanticInterference = decidePendingWriteInterference({
          hasPendingWrite,
          incomingActionRisk: semanticRisk,
          incomingMatchesExpectedField: shouldSkipTypedLateralForOdometerFlow(
            selectionText,
            thread,
          ),
        });
        if (semanticInterference === "overlay_read_keep_pending") {
          const overlay = await executeOverlayReadKeepPending({
            rawPhone,
            selectionText,
            apiKey,
            thread,
            pendingAction,
            pendingKind,
            mode: "gps_unidades",
            unidadesExtras: aiUnitExtras,
          });
          if (overlay) return overlay;
        }
        if (semanticInterference === "fork_incompatible_write" && !pendingKind) {
          const tramiteUnit = extractTramiteUnitAnchorFromThread(thread);
          return openIncompatibleWriteForkOrSafeReply({
            rawPhone,
            thread,
            pendingAction,
            pendingOperation:
              pendingAction?.type === "certificados"
                ? "certificados"
                : pendingAction?.type === "mantenimiento"
                  ? "mantenimiento"
                  : "meter_odometro",
            pausedExpectation: readTurnLayer(pendingAction)?.activeExpectation ?? null,
            executor: executorFromPendingAction(pendingAction),
            message: [
              tramiteUnit
                ? `Estás con un trámite en curso de *${tramiteUnit.displayLabel}*.`
                : "Estás con un trámite de escritura en curso.",
              "Pediste otro requerimiento incompatible.",
              "",
              "¿Qué preferís?",
              "• *Cambiar de requerimiento* — dejamos el trámite actual y arrancamos el nuevo.",
              "• *Seguir con el trámite* — terminamos lo pendiente primero.",
            ].join("\n"),
          });
        }
      }
    } else if (
      understanding &&
      !shouldProceedAsVehicleUnit(understanding) &&
      !activeUnitForNl?.plate
    ) {
      skipSchematicUnitRoute = true;
      console.info(
        `[utteranceUnderstanding] no-unidad phone=${rawPhone.slice(0, 4)}… referent=${understanding.referent} conf=${understanding.confidence}`,
      );
    } else if (
      understanding &&
      !shouldProceedAsVehicleUnit(understanding) &&
      activeUnitForNl?.plate
    ) {
      // Hay unidad activa: no saltear flota aunque la IA diga otro referent.
      skipSchematicUnitRoute = false;
      console.info(
        `[utteranceUnderstanding] hilo-unidad-activa-vs-referent phone=${rawPhone.slice(0, 4)}… plate=${activeUnitForNl.plate} referent=${understanding.referent}`,
      );
    }
  }

  // Guías de plataforma (Agenda, Perfiles, Notificaciones, Unidades…) → manual PDF + IA.
  // No dejar que el agente general invente botones/pasos fuera de la base de conocimiento.
  if (
    looksLikeOpcionesInfoRequest(selectionText) ||
    looksLikeUnidadesInfoRequest(selectionText)
  ) {
    const execResult = await invokeExecutor("info_guides", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage) {
      return { message: execMessage, executor: "info_guides", ok: execOk };
    }
  }

  // Mantenimiento operativo (incl. marca/prefijo en el mismo mensaje) → executor con búsqueda en flota.
  if (
    looksLikeOperationalMaintenanceIntent(selectionText, threadCtx.classificationThread) &&
    !hasPendingMantenimientoConfirmation(threadCtx.classificationThread)
  ) {
    const execResult = await invokeExecutor("mantenimiento", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "mantenimiento", ok: execOk };
    }
  }

  // Selección de patente/prefijo/marca en mantenimiento pendiente → executor, no agente.
  // Nunca si hay un resumen CONFIRMO más reciente (cert/odo/maint) o afirmación de trámite.
  if (
    hasPendingMaintenancePlateRequest(threadCtx.classificationThread) &&
    isMaintenancePlateSelectionMessage(selectionText) &&
    !hasPendingCertificateConfirmation(threadCtx.classificationThread) &&
    !hasPendingOdometerConfirmation(threadCtx.classificationThread) &&
    !hasPendingMantenimientoConfirmation(threadCtx.classificationThread)
  ) {
    const override = resolveExecutorOverStaleMaintenancePlateSelection(
      selectionText,
      threadCtx.classificationThread,
    );
    if (override) {
      if (pendingAction?.type === "mantenimiento") {
        await clearPendingAction(prisma, rawPhone);
      }
      const execResult = await invokeExecutor(override, rawPhone, selectionText, apiKey);
      const execMessage = messageFromPayload(execResult);
      const execOk = execResult.ok !== false && execResult.ok_s !== "false";
      if (execMessage || !executorSkippedSilently(execResult)) {
        return { message: execMessage, executor: override, ok: execOk };
      }
    } else {
      const execResult = await invokeExecutor("mantenimiento", rawPhone, selectionText, apiKey);
      const execMessage = messageFromPayload(execResult);
      const execOk = execResult.ok !== false && execResult.ok_s !== "false";
      if (execMessage) {
        return { message: execMessage, executor: "mantenimiento", ok: execOk };
      }
    }
  }

  // Plantilla operativa de odómetro (interno M300-xxx + km + fecha) — trámite siempre, aunque haya caso abierto.
  if (looksLikeStructuredOdometerUpdateRequest(selectionText)) {
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
  }

  // Arranque explícito odómetro/horómetro — antes de unidades/agente (también con marca en el mensaje).
  if (
    looksLikeExplicitOdometerUpdateRequest(selectionText) ||
    looksLikeHorometerOnlyIntent(selectionText)
  ) {
    if (pendingAction?.type === "mantenimiento") {
      await clearPendingAction(prisma, rawPhone);
    }
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    // Nunca devolver silencio: skip vacío o message="" deben caer al fallback genérico.
    if (execMessage.trim()) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
    if (!executorSkippedSilently(execResult)) {
      return {
        message:
          "Para el cambio de odómetro/horómetro necesito la unidad (patente o interno) y el valor. ¿Me los pasás?",
        executor: "odometro",
        ok: false,
      };
    }
  }

  // Pregunta informativa sobre odómetro — guía, no arrancar trámite con activeUnit.
  if (looksLikeOdometerInfoRequest(selectionText)) {
    const execResult = await invokeExecutor("info_guides", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage) {
      return { message: execMessage, executor: "info_guides", ok: execOk };
    }
  }

  const activeUnit = activeUnitForNl;

  // Arranque odómetro con unidad activa reciente (certificado/consulta GPS) → executor directo.
  if (
    activeUnit?.plate &&
    shouldUseActiveUnitFallback(selectionText) &&
    looksLikeExplicitOdometerUpdateRequest(selectionText) &&
    !threadOdometerRegistrationCompleted(threadCtx.classificationThread) &&
    !isOdometerFlowSuperseded(threadCtx.classificationThread) &&
    !threadHasActiveOdometerFlow(threadCtx.classificationThread)
  ) {
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
  }

  // Odómetro/horómetro activo: patente parcial, prefijo o km → executor, NO consulta GPS ni agente.
  if (
    shouldRouteTurnToOdometerExecutor({
      selectionText,
      threadText: threadCtx.classificationThread,
      pendingActionType: pendingAction?.type ?? null,
    })
  ) {
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
  }

  // Follow-up conversacional sobre unidad activa → executor con hechos, antes del agente.
  // Si la IA ya dijo que NO es unidad (ej. "nro de ticket"), no forzar flota.
  const threadForFollowUp = threadCtx.classificationThread;
  if (
    !skipSchematicUnitRoute &&
    activeUnit?.plate &&
    !looksLikeAnotherUnitConsultRequest(selectionText) &&
    !looksLikeExplicitOdometerUpdateRequest(selectionText) &&
    !looksLikeHorometerOnlyIntent(selectionText) &&
    !threadHasActiveOdometerFlow(threadForFollowUp) &&
    !threadHasRecentCustomerMeterUpdateIntent(threadForFollowUp) &&
    pendingAction?.type !== "odometro" &&
    !looksLikeGenericCapabilityOrTopicSwitchRequest(selectionText) &&
    (looksLikeUnitConsultFollowUp(selectionText) ||
      looksLikeUnitReportingStatusCue(selectionText) ||
      (threadHasRecentUnitProblemListenPrompt(threadForFollowUp) &&
        looksLikeSubstantiveCustomerMessage(selectionText)) ||
      ((threadHasRecentNoEquipmentExplanation(threadForFollowUp) ||
        threadHasRecentUnitCaseOpened(threadForFollowUp)) &&
        looksLikeSubstantiveCustomerMessage(selectionText)))
  ) {
    const execResult = await invokeExecutor(
      "unidades",
      rawPhone,
      selectionText,
      apiKey,
      aiUnitExtras,
    );
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (shouldUseAgentCompose(execResult)) {
      const dialogueState = parseExecutorDialogueState(execResult);
      if (dialogueState) {
        const composed = await composeAgentReplyFromDialogueState({
          threadText: threadForFollowUp,
          customerMessage: selectionText,
          dialogueState,
          fallbackTemplate: messageFromPayload(execResult),
        });
        if (composed) {
          return phaseFromExecResult(execResult, composed, "unidades", execOk);
        }
      }
    }
    const execMessage = messageFromPayload(execResult);
    if (execMessage) {
      return phaseFromExecResult(execResult, execMessage, "unidades", execOk);
    }
  }

  // Marca/prefijo/nombre/patente parcial → buscar en flota y listar similares (no pedir patente completa al agente).
  // Incluye unit_ref razonada por IA aunque el texto no matchee regex.
  if (
    !skipSchematicUnitRoute &&
    (shouldRouteTurnToUnidadesExecutor({
      selectionText,
      threadText: threadCtx.classificationThread,
    }) ||
      shouldForceUnidadesFromUnderstanding(lastUnderstanding))
  ) {
    const execResult = await invokeExecutor(
      "unidades",
      rawPhone,
      selectionText,
      apiKey,
      aiUnitExtras,
    );
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (shouldUseAgentCompose(execResult)) {
      const dialogueState = parseExecutorDialogueState(execResult);
      if (dialogueState) {
        const composed = await composeAgentReplyFromDialogueState({
          threadText: threadCtx.classificationThread,
          customerMessage: selectionText,
          dialogueState,
          fallbackTemplate: messageFromPayload(execResult),
        });
        if (composed) {
          return phaseFromExecResult(execResult, composed, "unidades", execOk);
        }
      }
    }
    const execMessage = messageFromPayload(execResult);
    if (execMessage || !executorSkippedSilently(execResult)) {
      return phaseFromExecResult(execResult, execMessage, "unidades", execOk);
    }
    // Consulta GPS/reporte sin mensaje → nunca silencio: disculpa + operador.
    if (
      looksLikeLiveUnitConsultIntent(selectionText) ||
      looksLikeGpsOrUnitStatusQuestion(selectionText) ||
      shouldRouteGpsConsultToUnidades(selectionText)
    ) {
      const { resolveConsultFailureAdvisorHandoff } = await import("@/lib/consultFailureHandoff");
      const handoff = await resolveConsultFailureAdvisorHandoff(prisma, rawPhone, {
        messageText: selectionText,
        seed: rawPhone,
        source: "unidades_empty_live_consult",
      });
      return { message: handoff.message, executor: "odoo_ticket", ok: true };
    }
  }

  // Prefijo/marca/patente parcial en trámite odómetro/horómetro activo → executor (no agente).
  if (
    isOdometerPlateSelectionMessage(selectionText) &&
    (pendingAction?.type === "odometro" ||
      threadHasActiveOdometerFlow(threadCtx.classificationThread) ||
      threadAwaitingHorometerKmValue(threadCtx.classificationThread) ||
      threadAwaitingOdometerKmValue(threadCtx.classificationThread))
  ) {
    const execResult = await invokeExecutor("odometro", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odometro", ok: execOk };
    }
  }

  const agentResult = await runAtilioAgentTurn({
    rawPhone,
    selectionText,
    apiKey,
    threadCtx,
  });
  if (agentResult?.usedAgent) {
    if (!String(agentResult.message ?? "").trim() && pendingKind) {
      return {
        message: buildPendingConfirmStillWaitingReminder(pendingKind),
        executor: agentResult.executor,
        ok: true,
      };
    }
    return {
      message: agentResult.message,
      executor: agentResult.executor,
      ok: agentResult.ok,
    };
  }

  let executor: TurnExecutorId;
  if (
    hasPendingOdometerActionChoice(pendingAction) &&
    looksLikeOdometerActionChoiceReply(selectionText)
  ) {
    executor = "odometro";
  } else if (
    pendingAction?.type === "certificados" &&
    pendingAction.payload?.stage === "awaiting_unit" &&
    shouldContinueCertificateUnitCollection(selectionText, threadCtx.classificationThread, pendingAction) &&
    !looksLikeBriefConfirmation(selectionText)
  ) {
    executor = "certificados";
  } else if (looksLikeBriefConfirmation(selectionText)) {
    const pendingConfirm = resolvePendingConfirmationExecutor(
      threadCtx.classificationThread,
      selectionText,
    );
    const resolved = await resolveTurnExecutor(
      selectionText,
      threadCtx.classificationThread,
      pendingAction,
    );
    executor = pendingConfirm ?? pendingAction?.type ?? resolved.executor;
  } else {
    const resolved = await resolveTurnExecutor(
      selectionText,
      threadCtx.classificationThread,
      pendingAction,
    );
    executor = resolved.executor;
  }

  let execResult = await invokeExecutor(executor, rawPhone, selectionText, apiKey);

  if (executorSkippedSilently(execResult)) {
    const recovery = inferRecoveryExecutor(
      selectionText,
      executor,
      threadCtx.classificationThread,
      execResult,
    );
    if (recovery && recovery !== executor) {
      const retryResult = await invokeExecutor(recovery, rawPhone, selectionText, apiKey);
      if (!executorSkippedSilently(retryResult) || messageFromPayload(retryResult)) {
        execResult = retryResult;
        executor = recovery;
      }
    }
  }

  const execMessage = messageFromPayload(execResult);
  const execOk = execResult.ok !== false && execResult.ok_s !== "false";
  const execSkip = executorSkippedSilently(execResult);
  let finalMessage = execSkip ? "" : execMessage;

  if (!finalMessage) {
    if (executor === "mantenimiento") {
      finalMessage =
        "Para registrar el mantenimiento necesito la patente de la unidad (formato AA123BB o ABC123) junto con un breve detalle y, si querés, la prioridad.";
    } else if (executor === "certificados") {
      finalMessage =
        "Para el certificado de cobertura necesito la unidad: pasame la patente o el interno (ej. 900133) y te lo armo.";
    } else if (executor === "odometro") {
      finalMessage =
        "Para el cambio de odómetro/horómetro necesito la unidad (patente o interno) y el valor. ¿Me los pasás?";
    } else if (
      executor === "unidades" &&
      (looksLikeLiveUnitConsultIntent(selectionText) ||
        looksLikeGpsOrUnitStatusQuestion(selectionText) ||
        shouldRouteGpsConsultToUnidades(selectionText) ||
        looksLikeGenericUnitConsultWithoutPlate(selectionText))
    ) {
      const { resolveConsultFailureAdvisorHandoff } = await import("@/lib/consultFailureHandoff");
      const handoff = await resolveConsultFailureAdvisorHandoff(prisma, rawPhone, {
        messageText: selectionText,
        seed: rawPhone,
        source: "unidades_fallback_empty",
      });
      finalMessage = handoff.message;
      executor = "odoo_ticket";
    } else if (executor === "unidades" && looksLikeFleetUnitSearchInput(selectionText)) {
      finalMessage = buildFleetUnitNotFoundMessage({ rawText: selectionText });
    } else if (pendingKind) {
      finalMessage = buildPendingConfirmStillWaitingReminder(pendingKind);
    } else {
      finalMessage = buildUnexpectedTurnFallbackMessage(selectionText);
    }
  }

  return {
    message: finalMessage,
    mediaUrl: finalMessage ? mediaUrlFromPayload(execResult) : undefined,
    executor,
    ok: execOk,
  };
}
