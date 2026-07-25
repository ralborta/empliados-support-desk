import { customerRegisteredContextResponse } from "@/lib/builderbotCustomerContext";
import { persistCustomerInbound } from "@/lib/customerTicketInquiry";
import {
  loadTurnThreadContext,
  recentLastInboundTextForPhone,
  shouldIgnoreDuplicateInicioTurn,
} from "@/lib/conversationThread";
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
import {
  runTurnExecutorPhase,
  scheduleDeferredTurnExecutor,
  shouldDeferTurnExecutor,
} from "@/lib/whatsappTurnExecutor";
import { clearPendingAction } from "@/lib/pendingAction";
import { prisma } from "@/lib/db";

type JsonRecord = Record<string, unknown>;

function buildTurnPayload(
  context: JsonRecord,
  overrides: Partial<JsonRecord> = {},
): JsonRecord {
  const nextFlow = String(overrides.nextFlow ?? context.nextFlow ?? "reply");
  const message = String(
    overrides.message ?? overrides.summaryText ?? context.message ?? context.summaryText ?? "",
  ).trim();
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
  apiKey: string;
}): Promise<JsonRecord> {
  const { rawPhone, body, apiKey } = params;
  const rawBody = body.trim();
  let selectionText = rawBody;

  if (!selectionText) {
    const lastInbound = await recentLastInboundTextForPhone(rawPhone);
    if (lastInbound) {
      if (await shouldIgnoreDuplicateInicioTurn(rawPhone, lastInbound)) {
        return deliverTurnToWhatsApp(
          rawPhone,
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
      if (
        looksLikeOperationalIntent(lastInbound) ||
        looksLikeSubstantiveCustomerMessage(lastInbound)
      ) {
        selectionText = lastInbound;
      }
    }
  }

  if (rawBody) {
    await persistCustomerInbound(rawPhone, rawBody, { source: "whatsapp_turn" }).catch(
      () => undefined,
    );
  }
  const threadCtx = await loadTurnThreadContext(rawPhone, selectionText);

  if (!allowPhoneRequest(rawPhone, 20)) {
    return deliverTurnToWhatsApp(
      rawPhone,
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
    if (
      looksLikeSubstantiveCustomerMessage(selectionText) ||
      isBarePlatePrefixHint(selectionText) ||
      hasPendingMaintenancePlateRequest(threadCtx.classificationThread)
    ) {
      // Bypass: /turn sigue procesando.
    } else {
      return deliverTurnToWhatsApp(
        rawPhone,
        buildTurnPayload(context, {
          message: "",
          skipResponse_s: "true",
          nextFlow: "ignore",
          nextFlow_s: "ignore",
          executor: "context",
          executor_s: "context",
        }),
      );
    }
  }

  if (contextNextFlow === "derivar") {
    return deliverTurnToWhatsApp(
      rawPhone,
      buildTurnPayload(context, {
        nextFlow: "derivar",
        nextFlow_s: "derivar",
        executor: "context",
        executor_s: "context",
      }),
    );
  }

  if (contextNextFlow === "reply") {
    return deliverTurnToWhatsApp(
      rawPhone,
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
    return deliverTurnToWhatsApp(
      rawPhone,
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
    const firstName = String(context.name ?? "")
      .trim()
      .split(/\s+/)[0];
    const ack = firstName
      ? `Dame un momento ${firstName}, estoy procesando tu consulta…`
      : "Dame un momento, estoy procesando tu consulta…";
    return deliverTurnToWhatsApp(
      rawPhone,
      buildTurnPayload(context, {
        message: ack,
        skipResponse_s: "false",
        nextFlow: "reply",
        nextFlow_s: "reply",
        executor: "deferred",
        executor_s: "deferred",
        deferredExecute_s: "true",
      }),
    );
  }

  const execPhase = await runTurnExecutorPhase({ rawPhone, selectionText, apiKey });
  return deliverTurnToWhatsApp(
    rawPhone,
    buildTurnPayload(context, {
      ok: execPhase.ok,
      ok_s: execPhase.ok ? "true" : "false",
      message: execPhase.message,
      nextFlow: "reply",
      nextFlow_s: "reply",
      executor: execPhase.executor,
      executor_s: execPhase.executor,
    }),
  );
}
