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
  type UtteranceUnderstanding,
} from "@/lib/utteranceUnderstanding";
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
  buildOdometerFlowSideHelpReply,
} from "@/lib/pendingConfirmStance";
import { buildOpenCaseStatusReply } from "@/lib/customerTicketInquiry";
import { looksLikeChangeCompanyRequestHybrid } from "@/lib/whatsappAdminIntentAI";
import { shouldRouteTurnToFleetListExecutorHybrid } from "@/lib/fleetListIntentAI";
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
import { getPendingAction, clearPendingAction, ensureOdometerCollectingTurnLayer, patchPendingActionPayload } from "@/lib/pendingAction";
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
  buildCollectingPayloadForPivot,
  buildResumeTurnLayerPatch,
  prepareStatusPivotDuringTramite,
  readPivotIntent,
  logTramitePivotTrace,
} from "@/lib/tramitePivot";
import {
  buildTramiteForkClarificationReply,
  buildCollectingPayloadForFork,
  isTurnLayerForkPending,
  looksLikeExplicitOtherTramiteIntent,
  threadAwaitingTramiteForkChoice,
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
} from "@/lib/typedLateralQueries";
import {
  agentComposeRequested,
  parseExecutorDialogueState,
} from "@/lib/executorDialogueState";
import {
  composeAgentReplyFromDialogueState,
} from "@/lib/atilioDialogueCompose";
import { isPassthroughGpsWhatsAppMessage } from "@/lib/waraGpsSummary";
import { isStructuredWhatsAppTemplate } from "@/lib/waraWhatsAppFormat";

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

function looksLikePendingCertificateUnitReply(text: string, threadText = ""): boolean {
  return shouldContinueCertificateUnitCollection(text, threadText);
}

function executorBody(
  rawPhone: string,
  body: string,
  extras?: { platePrefix?: string; plate?: string; unitSearchText?: string },
): JsonRecord {
  return {
    from: rawPhone,
    phone: rawPhone,
    body,
    rawText: body,
    ...(extras?.platePrefix ? { platePrefix: extras.platePrefix } : {}),
    ...(extras?.plate ? { patente: extras.plate, plate: extras.plate } : {}),
    ...(extras?.unitSearchText ? { unitSearchText: extras.unitSearchText } : {}),
  };
}

async function invokeExecutor(
  executor: TurnExecutorId,
  rawPhone: string,
  body: string,
  apiKey: string,
  extras?: { platePrefix?: string; plate?: string; unitSearchText?: string },
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
  const pendingAction = await getPendingAction(prisma, rawPhone);
  const thread = threadCtx.classificationThread;

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
  if (
    looksLikeCustomerImageAttachmentCue(selectionText) &&
    (looksLikeGpsFeatureIssueForAdvisor(selectionText) ||
      looksLikeExplicitReclamoOrTicketRequest(selectionText) ||
      looksLikeOutOfScopeSupportClaim(selectionText) ||
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

  // Retomar trámite inconcluso (sin CONFIRMO): preguntar antes de continuar.
  if (
    looksLikeResumeInconclusiveTramite(selectionText) &&
    threadHasInconclusiveTramite(thread, pendingAction) &&
    !detectPendingConfirmKind(thread)
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
        executor: "odometro",
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

  // Pivot estado/GPS de otra unidad durante recolección — fork sin ejecutar herramientas.
  if (
    !pendingKind &&
    (pendingAction?.type === "odometro" ||
      (threadHasActiveOdometerFlow(thread) && !threadOdometerRegistrationCompleted(thread)))
  ) {
    const pivotPrep = await prepareStatusPivotDuringTramite({
      prisma,
      rawPhone,
      selectionText,
      threadText: thread,
      pendingAction,
    });
    if (pivotPrep?.kind === "fork") {
      await ensureOdometerCollectingTurnLayer(
        prisma,
        rawPhone,
        thread,
        buildCollectingPayloadForPivot(thread, pivotPrep.pivot, pendingAction?.payload),
      );
      return {
        message: pivotPrep.message,
        executor: "odometro",
        ok: true,
      };
    }
  }

  // Laterales tipadas (empresa, guías, GPS) sin perder trámite en curso.
  const typedLateralKind = classifyTypedLateralQuery(selectionText);
  if (
    typedLateralKind &&
    tramiteAllowsTypedLateralOverlay(thread, pendingAction) &&
    !shouldSkipTypedLateralForOdometerFlow(selectionText, thread)
  ) {
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
    if (pendingKind) {
      return {
        message: `${lateralBody}\n\n${buildPendingConfirmStillWaitingReminder(pendingKind)}`,
        executor:
          pendingKind === "odometro"
            ? "odometro"
            : pendingKind === "certificados"
              ? "certificados"
              : "mantenimiento",
        ok: lateralOk,
      };
    }
    if (
      threadHasActiveOdometerFlow(thread) &&
      !threadOdometerRegistrationCompleted(thread)
    ) {
      await ensureOdometerCollectingTurnLayer(
        prisma,
        rawPhone,
        thread,
        buildCollectingPayloadForFork(thread, pendingAction?.payload),
      );
      return {
        message: `${lateralBody}\n\n${buildOdometerFlowSideHelpReply(thread)}`,
        executor: "odometro",
        ok: lateralOk,
      };
    }
    const inconclusiveExecutor =
      pendingAction?.type === "certificados" ||
      pendingAction?.type === "mantenimiento" ||
      pendingAction?.type === "odometro"
        ? pendingAction.type
        : typedLateralKind === "gps_unit_status"
          ? "unidades"
          : "info_guides";
    return {
      message: lateralBody,
      executor: inconclusiveExecutor,
      ok: lateralOk,
    };
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
  if (
    looksLikeHumanAdvisorRequest(selectionText) ||
    looksLikeTechnicalSupportRequest(selectionText) ||
    looksLikeExplicitReclamoOrTicketRequest(selectionText) ||
    looksLikeOutOfScopeSupportClaim(selectionText) ||
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
    const executor = pendingConfirmExecutor ?? pendingTramiteType!;
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
    await ensureOdometerCollectingTurnLayer(
      prisma,
      rawPhone,
      threadCtx.classificationThread,
      buildCollectingPayloadForFork(threadCtx.classificationThread, pendingAction?.payload),
    );
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
  let aiUnitExtras: { platePrefix?: string; plate?: string; unitSearchText?: string } | undefined;
  const activeUnitForNl = await getActiveUnit(prisma, rawPhone);
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
    const aiHint = unitSearchHintFromUnderstanding(understanding);
    const plateInMsg = detectLoosePlate(selectionText);
    const regexPlateOk =
      !!plateInMsg && isPlausibleVehiclePlate(normalizePlate(plateInMsg));
    const regexPrefix = extractPlatePrefixFromMessage(selectionText);
    const explicitUnitCode = extractExplicitUnitNameFromText(selectionText);
    const movilIdFromMsg = extractMovilIdFromUnitMessage(selectionText, {
      threadText: threadCtx.classificationThread,
    });
    // Código interno (300-097) gana sobre marca/nombre libre de la IA — bug real 2026-08-06.
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
    aiUnitExtras = {
      ...(prefixHint ? { platePrefix: prefixHint } : {}),
      ...(!regexPlateOk && aiHint?.plate ? { plate: aiHint.plate } : {}),
      ...(freeName ? { unitSearchText: freeName } : {}),
    };
    if (!aiUnitExtras.platePrefix && !aiUnitExtras.plate && !aiUnitExtras.unitSearchText) {
      aiUnitExtras = undefined;
    }

    // Si el mensaje (o la IA) ya trae patente/prefijo/nombre usable, no preguntar — ejecutar flota.
    const clarify = clarificationFromUnderstanding(understanding, selectionText);
    if (
      clarify &&
      !hasUsablePlate &&
      !hasUsablePrefix &&
      !hasUsableName &&
      !hasUsableMovilId &&
      !activeUnitForNl?.plate &&
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
    // Pedir matrícula SOLO si no hay unidad/prefijo/nombre en contexto.
    if (
      understanding &&
      shouldProceedAsVehicleUnit(understanding) &&
      !hasUsablePlate &&
      !hasUsablePrefix &&
      !hasUsableName &&
      !isBarePlatePrefixHint(selectionText) &&
      !looksLikeFleetUnitSearchInput(selectionText) &&
      !activeUnitForNl?.plate &&
      !threadAwaitingUnitProblem
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
        `[utteranceUnderstanding] unidad-sin-dato phone=${rawPhone.slice(0, 4)}… referent=${understanding.referent}`,
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
      !activeUnitForNl?.plate &&
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
      !!activeUnitForNl?.plate &&
      !looksLikeAnotherUnitConsultRequest(selectionText) &&
      (threadAwaitingUnitProblem ||
        looksLikeUnitConsultFollowUp(selectionText) ||
        looksLikeUnitReportingStatusCue(selectionText) ||
        looksLikeGpsOrUnitStatusQuestion(selectionText) ||
        looksLikeLiveUnitConsultIntent(selectionText) ||
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
          `[utteranceUnderstanding] hilo-unidad-activa phone=${rawPhone.slice(0, 4)}… plate=${activeUnitForNl?.plate}`,
        );
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
  // Si el mensaje trae otro servicio explícito (estado/cert/odo) o el pedido GPS es más
  // reciente, no secuestrar el turno hacia mantenimiento.
  if (
    hasPendingMaintenancePlateRequest(threadCtx.classificationThread) &&
    isMaintenancePlateSelectionMessage(selectionText)
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
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "odometro", ok: execOk };
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
    const resolved = await resolveTurnExecutor(selectionText, threadCtx.classificationThread);
    executor = pendingConfirm ?? pendingAction?.type ?? resolved.executor;
  } else {
    const resolved = await resolveTurnExecutor(selectionText, threadCtx.classificationThread);
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
    } else if (executor === "unidades" && looksLikeFleetUnitSearchInput(selectionText)) {
      finalMessage = buildFleetUnitNotFoundMessage({ rawText: selectionText });
    } else if (
      executor === "unidades" &&
      (looksLikeLiveUnitConsultIntent(selectionText) ||
        looksLikeGpsOrUnitStatusQuestion(selectionText) ||
        looksLikeGenericUnitConsultWithoutPlate(selectionText))
    ) {
      finalMessage =
        "Para revisar el GPS, la ignición o el reporte necesito la unidad: pasame la patente (ej. AD427MC), el código (ej. M300-097) o el número de unidad (ej. 600088).";
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
