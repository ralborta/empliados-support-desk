import { customerRegisteredContextResponse } from "@/lib/builderbotCustomerContext";
import { persistCustomerInbound } from "@/lib/customerTicketInquiry";
import {
  loadTurnThreadContext,
  recentLastInboundTextForPhone,
  shouldIgnoreDuplicateInicioTurn,
} from "@/lib/conversationThread";
import {
  mergeInboundTextWithAiImage,
  looksLikeInboundMediaOnlyEvent,
  selectionHasAiImageContext,
  hasUsableAiImageDescription,
} from "@/lib/inboundImagePolicy";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";
import { bbcShouldSendExecutorMessage, shouldTurnSendWhatsAppToCustomer } from "@/lib/waraInboundAudit";
import {
  looksLikeFlowControlCommand,
  looksLikeOperationalIntent,
  looksLikeSubstantiveCustomerMessage,
} from "@/lib/waraApi";
import {
  hasPendingMaintenancePlateRequest,
  isBarePlatePrefixHint,
} from "@/lib/wara";
import { deliverTurnToWhatsApp } from "@/lib/whatsappTurnDelivery";
import { extractMediaUrlAndCleanText } from "@/lib/mediaUrlMarker";
import {
  runTurnExecutorPhase,
  scheduleDeferredTurnExecutor,
  shouldDeferTurnExecutor,
} from "@/lib/whatsappTurnExecutor";
import { clearPendingAction } from "@/lib/pendingAction";
import { prisma } from "@/lib/db";
import { maybeEnqueueWaraV2ShadowCopy } from "@/lib/waraV2ShadowCanaryHook";

type JsonRecord = Record<string, unknown>;

function buildTurnPayload(
  context: JsonRecord,
  overrides: Partial<JsonRecord> = {},
): JsonRecord {
  const nextFlow = String(overrides.nextFlow ?? context.nextFlow ?? "reply");
  const rawMessage = String(
    overrides.message ?? overrides.summaryText ?? context.message ?? context.summaryText ?? "",
  ).trim();
  const extracted = extractMediaUrlAndCleanText(rawMessage);
  const message = extracted.text;
  const mediaUrl =
    extracted.mediaUrl ?? (String(overrides.mediaUrl ?? "").trim() || undefined);
  const skipResponse =
    overrides.skipResponse_s ??
    (shouldTurnSendWhatsAppToCustomer()
      ? "true"
      : message
        ? bbcShouldSendExecutorMessage()
          ? "false"
          : "true"
        : "true");

  return {
    ...context,
    ...overrides,
    ok: overrides.ok ?? true,
    ok_s: String(overrides.ok_s ?? (overrides.ok === false ? "false" : "true")),
    message,
    summaryText: String(overrides.summaryText ?? message),
    ...(mediaUrl ? { mediaUrl, mediaUrl_s: mediaUrl } : {}),
    skipResponse_s: skipResponse,
    flowComplete_s: overrides.flowComplete_s ?? "true",
    nextFlow,
    nextFlow_s: String(overrides.nextFlow_s ?? nextFlow),
  };
}

/**
 * Fase 1 completa — un turno WhatsApp: contexto mínimo + cerebro único en backend.
 * BBC ya no re-clasifica (sin bbc_router / Router GPT).
 */
export async function handleWhatsAppTurn(params: {
  rawPhone: string;
  body: string;
  /** Descripción de imagen/PDF de BBC ({aiImage}) cuando interpretImage está activo. */
  aiImage?: string;
  /** BBC indica adjunto sin caption útil (imagen/PDF). */
  hasMedia?: boolean;
  /** Id del mensaje WhatsApp (wamid) — dedup y protección anti-smoke en clientes. */
  messageId?: string;
  apiKey: string;
}): Promise<JsonRecord> {
  const { rawPhone, body, apiKey, messageId } = params;
  const trimmedBody = body.trim();
  const rawBody = mergeInboundTextWithAiImage(trimmedBody, params.aiImage).trim();
  let selectionText = rawBody;

  const deliver = (payload: JsonRecord) =>
    deliverTurnToWhatsApp(rawPhone, {
      ...payload,
      turnSelectionText: selectionText,
      turnMessageId: messageId ?? "",
    });

  const turnMessageId = String(messageId ?? "").trim();
  if (turnMessageId) {
    const prior = await prisma.ticketMessage.findFirst({
      where: { externalMessageId: turnMessageId },
      select: { id: true },
    });
    if (prior) {
      return deliver(
        buildTurnPayload(
          { registered: true, registered_s: "true" },
          {
            message: "",
            skipResponse_s: "true",
            nextFlow: "ignore",
            nextFlow_s: "ignore",
            executor: "context",
            executor_s: "duplicate_message_id",
          },
        ),
      );
    }
  }

  const inboundMediaOnly =
    params.hasMedia === true ||
    looksLikeInboundMediaOnlyEvent(trimmedBody) ||
    looksLikeInboundMediaOnlyEvent(rawBody);

  if (!selectionText) {
    const lastInbound = await recentLastInboundTextForPhone(rawPhone);
    if (lastInbound) {
      if (await shouldIgnoreDuplicateInicioTurn(rawPhone, lastInbound)) {
        return deliver(
          buildTurnPayload(
            { registered: true, registered_s: "true" },
            {
              message: "",
              skipResponse_s: "true",
              nextFlow: "ignore",
              nextFlow_s: "ignore",
              executor: "context",
              executor_s: "empty_body_duplicate",
            },
          ),
        );
      }
      // No reusar lastInbound si el body vino vacío: suele ser imagen/archivo sin caption.
      if (
        trimmedBody !== "" &&
        (looksLikeOperationalIntent(lastInbound) ||
          looksLikeSubstantiveCustomerMessage(lastInbound))
      ) {
        selectionText = lastInbound;
      }
    }
  }

  if (
    inboundMediaOnly &&
    !hasUsableAiImageDescription(params.aiImage) &&
    !selectionHasAiImageContext(selectionText)
  ) {
    selectionText = rawBody || trimmedBody || "_event_image__";
  } else if (
    !selectionText &&
    trimmedBody === "" &&
    !hasUsableAiImageDescription(params.aiImage)
  ) {
    // Webhook vacío sin señal de media: no asumir imagen ni contestar al cliente.
    return deliver(
      buildTurnPayload(
        { registered: true, registered_s: "true" },
        {
          message: "",
          skipResponse_s: "true",
          nextFlow: "ignore",
          nextFlow_s: "ignore",
          executor: "context",
          executor_s: "empty_inbound_no_media",
        },
      ),
    );
  }

  if (rawBody) {
    await persistCustomerInbound(rawPhone, rawBody, {
      source: "whatsapp_turn",
      ...(turnMessageId ? { messageId: turnMessageId } : {}),
    }).catch(() => undefined);
  }

  // Fase 10A: copia shadow desacoplada (no-op si flags off / kill / sin API V2)
  if (selectionText) {
    maybeEnqueueWaraV2ShadowCopy({
      rawPhone,
      text: selectionText,
      hasAttachment: inboundMediaOnly || selectionHasAiImageContext(selectionText),
    });
  }

  const threadCtx = await loadTurnThreadContext(rawPhone, selectionText);

  if (!allowPhoneRequest(rawPhone, 20)) {
    return deliver(
      buildTurnPayload(
        { registered: true, registered_s: "true" },
        {
          ok: false,
          ok_s: "false",
          nextFlow: "reply",
          nextFlow_s: "reply",
          message: "Recibí muchas solicitudes seguidas. Esperá un momento e intentá de nuevo.",
          executor: "rate_limit",
          executor_s: "rate_limit",
        },
      ),
    );
  }

  const contextRes = await customerRegisteredContextResponse(rawPhone, {
    selectionText: selectionText || undefined,
  });
  const context = (await contextRes.json().catch(() => ({}))) as JsonRecord;
  const contextNextFlow = String(context.nextFlow ?? "derivar");

  if (contextNextFlow === "ignore") {
    const contextRegistered =
      context.registered === true || String(context.registered_s) === "true";
    const humanTakeover =
      context.botPaused === true || String(context.botPaused_s) === "true";
    // No bypassear ignore en números no registrados: ya están derivados a asesor;
    // si no, "Ad198en" u otro mensaje sustantivo reabría el router en loop.
    // Tampoco bypassear si hay takeover humano (Atilio pausado en panel).
    if (
      !humanTakeover &&
      contextRegistered &&
      (looksLikeSubstantiveCustomerMessage(selectionText) ||
        isBarePlatePrefixHint(selectionText) ||
        hasPendingMaintenancePlateRequest(threadCtx.classificationThread) ||
        looksLikeInboundMediaOnlyEvent(selectionText) ||
        selectionHasAiImageContext(selectionText))
    ) {
      // Bypass: /turn sigue procesando.
    } else {
      return deliver(
        buildTurnPayload(context, {
          message: "",
          skipResponse_s: "true",
          nextFlow: "ignore",
          nextFlow_s: "ignore",
          executor: humanTakeover ? "human_takeover" : "context",
          executor_s: humanTakeover ? "human_takeover" : "context",
        }),
      );
    }
  }

  if (contextNextFlow === "derivar") {
    return deliver(
      buildTurnPayload(context, {
        nextFlow: "derivar",
        nextFlow_s: "derivar",
        executor: "context",
        executor_s: "context",
      }),
    );
  }

  if (contextNextFlow === "reply") {
    return deliver(
      buildTurnPayload(context, {
        nextFlow: "reply",
        nextFlow_s: "reply",
        executor: "context",
        executor_s: "context",
      }),
    );
  }

  if (looksLikeFlowControlCommand(selectionText)) {
    await clearPendingAction(prisma, rawPhone);
    const firstName = String(context.name ?? "")
      .trim()
      .split(/\s+/)[0];
    const resetMessage = firstName
      ? `Hola ${firstName}, arrancamos de nuevo. ¿En qué te puedo ayudar?`
      : "Hola, arrancamos de nuevo. ¿En qué te puedo ayudar?";
    return deliver(
      buildTurnPayload(context, {
        message: resetMessage,
        nextFlow: "reply",
        nextFlow_s: "reply",
        executor: "context",
        executor_s: "flow_reset",
      }),
    );
  }

  if (shouldDeferTurnExecutor()) {
    scheduleDeferredTurnExecutor({ rawPhone, selectionText, apiKey });
    // Sin mensaje intermedio: el cliente recibe solo la respuesta real vía waitUntil + API WA.
    return deliver(
      buildTurnPayload(context, {
        message: "",
        skipResponse_s: "true",
        nextFlow: "reply",
        nextFlow_s: "reply",
        executor: "deferred",
        executor_s: "deferred",
        deferredExecute_s: "true",
      }),
    );
  }

  const execPhase = await runTurnExecutorPhase({ rawPhone, selectionText, apiKey });
  return deliver(
    buildTurnPayload(context, {
      ok: execPhase.ok,
      ok_s: execPhase.ok ? "true" : "false",
      message: execPhase.message,
      mediaUrl: execPhase.mediaUrl,
      nextFlow: "reply",
      nextFlow_s: "reply",
      executor: execPhase.executor,
      executor_s: execPhase.executor,
    }),
  );
}
