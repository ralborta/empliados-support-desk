import { NextRequest, NextResponse } from "next/server";
import { POST as odooTicketPost } from "@/app/api/odoo/ticket/route";
import { POST as certificadosPost } from "@/app/api/wara/certificados/route";
import { POST as infoGuidesPost } from "@/app/api/wara/info-guides/route";
import { POST as mantenimientoPost } from "@/app/api/wara/mantenimiento-operativo/route";
import { POST as odometroPost } from "@/app/api/wara/odometro-horometro/route";
import { POST as unidadesPost } from "@/app/api/wara/unidades/route";
import { customerRegisteredContextResponse } from "@/lib/builderbotCustomerContext";
import { loadTurnThreadContext } from "@/lib/conversationThread";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";
import { bbcShouldSendExecutorMessage, shouldTurnSendWhatsAppToCustomer } from "@/lib/waraInboundAudit";
import {
  classifyTurnExecutor,
  TURN_EXECUTOR_PATH,
  type TurnExecutorId,
} from "@/lib/whatsappTurnRouter";
import {
  buildUnexpectedTurnFallbackMessage,
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeSubstantiveCustomerMessage,
} from "@/lib/waraApi";
import {
  hasPendingMaintenancePlateRequest,
  isBarePlatePrefixHint,
} from "@/lib/wara";
import {
  buildFleetUnitNotFoundMessage,
  looksLikeFleetUnitSearchInput,
} from "@/lib/waraUnitIntent";
import { deliverTurnToWhatsApp } from "@/lib/whatsappTurnDelivery";

type JsonRecord = Record<string, unknown>;

type ExecutorHandler = (req: NextRequest) => Promise<NextResponse>;

const EXECUTOR_HANDLERS: Record<TurnExecutorId, ExecutorHandler> = {
  unidades: unidadesPost,
  odometro: odometroPost,
  certificados: certificadosPost,
  mantenimiento: mantenimientoPost,
  odoo_ticket: odooTicketPost,
  info_guides: infoGuidesPost,
};

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

function inferRecoveryExecutor(
  selectionText: string,
  failedExecutor: TurnExecutorId,
): TurnExecutorId | null {
  if (looksLikeGpsOrUnitStatusQuestion(selectionText)) return "unidades";
  if (looksLikeExplicitReclamoOrTicketRequest(selectionText)) return "odoo_ticket";
  if (failedExecutor === "info_guides") return null;
  return null;
}

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
  const selectionText = body.trim();
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

  let executor = classifyTurnExecutor(selectionText, threadCtx.classificationThread);
  let execResult = await invokeExecutor(executor, rawPhone, body, apiKey);

  if (executorSkippedSilently(execResult)) {
    const recovery = inferRecoveryExecutor(selectionText, executor);
    if (recovery && recovery !== executor) {
      const retryResult = await invokeExecutor(recovery, rawPhone, body, apiKey);
      if (!executorSkippedSilently(retryResult) || messageFromPayload(retryResult)) {
        execResult = retryResult;
        executor = recovery;
      }
    }
  }

  const execMessage = messageFromPayload(execResult);
  const execOk = execResult.ok !== false && execResult.ok_s !== "false";
  let execSkip = executorSkippedSilently(execResult);
  let finalMessage = execSkip ? "" : execMessage || String(context.message ?? "");

  if (!finalMessage) {
    if (executor === "mantenimiento") {
      finalMessage =
        "Para registrar el mantenimiento necesito la patente de la unidad (formato AA123BB o ABC123) junto con un breve detalle y, si querés, la prioridad.";
    } else if (executor === "unidades" && looksLikeFleetUnitSearchInput(selectionText)) {
      finalMessage = buildFleetUnitNotFoundMessage({ rawText: selectionText });
    } else {
      finalMessage = buildUnexpectedTurnFallbackMessage(selectionText);
    }
    execSkip = false;
  }

  return deliverTurnToWhatsApp(
    rawPhone,
    buildTurnPayload(context, {
      ok: execOk,
      ok_s: execOk ? "true" : "false",
      message: finalMessage,
      skipResponse_s: execSkip ? "true" : undefined,
      flowComplete_s: execResult.flowComplete_s ?? "true",
      nextFlow: "reply",
      nextFlow_s: "reply",
      executor,
      executor_s: executor,
      executorResult: execResult,
    }),
  );
}
