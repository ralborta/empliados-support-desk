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
  buildUnexpectedTurnFallbackMessage,
  buildAtilioHelpCapabilitiesReply,
  buildTicketCreationInfoReply,
  looksLikeBareAtilioMention,
  looksLikeChangeCompanyRequest,
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeGenericCapabilityOrTopicSwitchRequest,
  looksLikeGenericUnitConsultWithoutPlate,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  looksLikeTicketCreationInfoQuestion,
  looksLikeUnitConsultFollowUp,
  looksLikeSubstantiveCustomerMessage,
  looksLikeMaintenanceConfirmationRejection,
  resetCustomerCompanyMenu,
  threadHasRecentNoEquipmentExplanation,
  threadHasRecentUnitCaseOpened,
} from "@/lib/waraApi";
import { looksLikeChangeCompanyRequestHybrid } from "@/lib/whatsappAdminIntentAI";
import { shouldRouteTurnToFleetListExecutorHybrid } from "@/lib/fleetListIntentAI";
import {
  isBarePlatePrefixHint,
  looksLikeBriefConfirmation,
  looksLikePendingTramiteAffirmation,
  detectLoosePlate,
  hasPendingMaintenancePlateRequest,
  threadHasActiveOdometerFlow,
  threadOdometerRegistrationCompleted,
  looksLikeCertificateKeyword,
  certificateFlowState,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
  hasPendingMantenimientoConfirmation,
  isOdometerFlowSuperseded,
  looksLikeOdometerInfoRequest,
  looksLikeStructuredOdometerUpdateRequest,
  looksLikeUnitRejection,
  looksLikeBareNegativeResponse,
} from "@/lib/wara";
import {
  isMaintenancePlateSelectionMessage,
  shouldRouteTurnToFleetListExecutor,
  shouldRouteTurnToOdometerExecutor,
  shouldRouteTurnToUnidadesExecutor,
  buildFleetUnitNotFoundMessage,
  looksLikeFleetUnitSearchInput,
  looksLikeUnitNameInMessage,
} from "@/lib/waraUnitIntent";
import { waitUntil } from "@vercel/functions";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import { getPendingAction, clearPendingAction } from "@/lib/pendingAction";
import { getActiveUnit, clearActiveUnit, shouldUseActiveUnitFallback } from "@/lib/activeUnit";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { prisma } from "@/lib/db";
import { runAtilioAgentTurn } from "@/lib/atilioAgent";
import { resolvePendingConfirmationExecutor } from "@/lib/pendingConfirmation";
import {
  agentComposeRequested,
  parseExecutorDialogueState,
} from "@/lib/executorDialogueState";
import {
  composeAgentReplyFromDialogueState,
} from "@/lib/atilioDialogueCompose";

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

function looksLikePendingCertificateUnitReply(text: string): boolean {
  return (
    !!detectLoosePlate(text) ||
    isBarePlatePrefixHint(text) ||
    looksLikeFleetUnitSearchInput(text) ||
    looksLikeUnitNameInMessage(text)
  );
}

function executorBody(rawPhone: string, body: string): JsonRecord {
  return {
    from: rawPhone,
    phone: rawPhone,
    body,
    rawText: body,
  };
}

async function invokeExecutor(
  executor: TurnExecutorId,
  rawPhone: string,
  body: string,
  apiKey: string,
): Promise<JsonRecord> {
  const handler = EXECUTOR_HANDLERS[executor];
  const req = new NextRequest(`http://internal${TURN_EXECUTOR_PATH[executor]}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(executorBody(rawPhone, body)),
  });
  const res = await handler(req);
  return (await res.json().catch(() => ({}))) as JsonRecord;
}

function messageFromPayload(data: JsonRecord): string {
  return String(data.message ?? data.summaryText ?? "").trim();
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
        if (!result.message) return;
        await sendWhatsAppMessage({ number: params.rawPhone, message: result.message });
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
}): Promise<{ message: string; executor: TurnExecutorId; ok: boolean }> {
  const { rawPhone, selectionText, apiKey } = params;

  if (
    looksLikeChangeCompanyRequest(selectionText) ||
    (await looksLikeChangeCompanyRequestHybrid(selectionText))
  ) {
    const reset = await resetCustomerCompanyMenu(prisma, rawPhone);
    return { message: reset.message, executor: "unidades", ok: true };
  }

  // Cambio de tema / otra consulta — no repetir unidad activa ni GPS previo (bug AE 483 VE).
  if (looksLikeGenericCapabilityOrTopicSwitchRequest(selectionText)) {
    await clearActiveUnit(prisma, rawPhone);
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    const firstName = customer?.name?.trim().split(/\s+/)[0];
    const message = looksLikeBareAtilioMention(selectionText)
      ? firstName
        ? `Hola ${firstName}, ¿en qué te puedo ayudar?`
        : "Hola, ¿en qué te puedo ayudar?"
      : buildAtilioHelpCapabilitiesReply(firstName);
    return { message, executor: "info_guides", ok: true };
  }

  if (looksLikeTicketCreationInfoQuestion(selectionText)) {
    await clearActiveUnit(prisma, rawPhone);
    return {
      message: buildTicketCreationInfoReply(),
      executor: "info_guides",
      ok: true,
    };
  }

  if (looksLikeUnitRejection(selectionText) || looksLikeBareNegativeResponse(selectionText)) {
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "unidades", ok: execOk };
    }
  }

  const threadCtx = await loadTurnThreadContext(rawPhone, selectionText);
  const pendingAction = await getPendingAction(prisma, rawPhone);

  if (
    hasPendingMantenimientoConfirmation(threadCtx.classificationThread) &&
    looksLikeMaintenanceConfirmationRejection(selectionText)
  ) {
    await clearPendingAction(prisma, rawPhone);
    const message =
      "Entendido, no registro ese mantenimiento. ¿En qué más te puedo ayudar? Podés pedirme odómetro, horómetro, certificado o consultar el estado de una unidad.";
    return { message, executor: "info_guides", ok: true };
  }

  // Confirmación de trámite: el backend registra con los datos guardados — no dejar que
  // el agente reinterprete "Confirmo" / "esa está bien" ni dependa del marcador exacto
  // "voy a registrar:" en el hilo (el agente parafrasea el resumen).
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
  }

  // Confirmación en flujo de odómetro activo: ir directo al executor (no agente IA),
  // aunque el resumen haya sido parafraseado sin "Voy a registrar:" ni pendingAction en DB.
  if (
    (looksLikePendingTramiteAffirmation(selectionText) ||
      looksLikeBriefConfirmation(selectionText)) &&
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

  // Selección de patente/prefijo/marca en mantenimiento pendiente → executor, no agente.
  if (
    hasPendingMaintenancePlateRequest(threadCtx.classificationThread) &&
    isMaintenancePlateSelectionMessage(selectionText)
  ) {
    const execResult = await invokeExecutor("mantenimiento", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage) {
      return { message: execMessage, executor: "mantenimiento", ok: execOk };
    }
  }

  // Listado de flota → executor unidades directo (NUNCA pedir patente para listar).
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
      return { message: execMessage, executor: "unidades", ok: execOk };
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

  // Pregunta informativa sobre odómetro — guía, no arrancar trámite con activeUnit.
  if (looksLikeOdometerInfoRequest(selectionText)) {
    const execResult = await invokeExecutor("info_guides", rawPhone, selectionText, apiKey);
    const execMessage = messageFromPayload(execResult);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (execMessage) {
      return { message: execMessage, executor: "info_guides", ok: execOk };
    }
  }

  const activeUnit = await getActiveUnit(prisma, rawPhone);

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
  const threadForFollowUp = threadCtx.classificationThread;
  if (
    activeUnit?.plate &&
    !threadHasActiveOdometerFlow(threadForFollowUp) &&
    pendingAction?.type !== "odometro" &&
    !looksLikeGenericCapabilityOrTopicSwitchRequest(selectionText) &&
    (looksLikeUnitConsultFollowUp(selectionText) ||
      ((threadHasRecentNoEquipmentExplanation(threadForFollowUp) ||
        threadHasRecentUnitCaseOpened(threadForFollowUp)) &&
        looksLikeSubstantiveCustomerMessage(selectionText)))
  ) {
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (agentComposeRequested(execResult)) {
      const dialogueState = parseExecutorDialogueState(execResult);
      if (dialogueState) {
        const composed = await composeAgentReplyFromDialogueState({
          threadText: threadForFollowUp,
          customerMessage: selectionText,
          dialogueState,
          fallbackTemplate: messageFromPayload(execResult),
        });
        if (composed) {
          return { message: composed, executor: "unidades", ok: execOk };
        }
      }
    }
    const execMessage = messageFromPayload(execResult);
    if (execMessage) {
      return { message: execMessage, executor: "unidades", ok: execOk };
    }
  }

  // Marca/prefijo/nombre/patente parcial → buscar en flota y listar similares (no pedir patente completa al agente).
  if (
    shouldRouteTurnToUnidadesExecutor({
      selectionText,
      threadText: threadCtx.classificationThread,
    })
  ) {
    const execResult = await invokeExecutor("unidades", rawPhone, selectionText, apiKey);
    const execOk = execResult.ok !== false && execResult.ok_s !== "false";
    if (agentComposeRequested(execResult)) {
      const dialogueState = parseExecutorDialogueState(execResult);
      if (dialogueState) {
        const composed = await composeAgentReplyFromDialogueState({
          threadText: threadCtx.classificationThread,
          customerMessage: selectionText,
          dialogueState,
          fallbackTemplate: messageFromPayload(execResult),
        });
        if (composed) {
          return { message: composed, executor: "unidades", ok: execOk };
        }
      }
    }
    const execMessage = messageFromPayload(execResult);
    if (execMessage || !executorSkippedSilently(execResult)) {
      return { message: execMessage, executor: "unidades", ok: execOk };
    }
  }

  const agentResult = await runAtilioAgentTurn({
    rawPhone,
    selectionText,
    apiKey,
    threadCtx,
  });
  if (agentResult?.usedAgent) {
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
    looksLikePendingCertificateUnitReply(selectionText) &&
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
        "Para revisar el GPS, la ignición o el reporte necesito la unidad: pasame la patente (ej. AD427MC) o la marca/nombre (ej. Nissan).";
    } else {
      finalMessage = buildUnexpectedTurnFallbackMessage(selectionText);
    }
  }

  return { message: finalMessage, executor, ok: execOk };
}
