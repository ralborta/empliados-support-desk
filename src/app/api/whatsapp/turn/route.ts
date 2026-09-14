import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isCustomerContextAuthConfigured,
  requireBuilderBotContextAuth,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { handleWhatsAppTurn } from "@/lib/whatsappTurn";

export const maxDuration = 60;
const TURN_FAILURE_MESSAGE =
  "Tuve un inconveniente procesando la consulta. Intentá nuevamente en unos minutos.";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    body: z.string().optional(),
    rawText: z.string().optional(),
    message: z.string().optional(),
    /** Descripción multimodal de BBC cuando interpretImage está activo ({aiImage}). */
    aiImage: z.string().optional(),
    /** true cuando el mensaje trae imagen/PDF/video sin caption operativo. */
    hasMedia: z.union([z.boolean(), z.string(), z.number()]).optional(),
    has_media: z.union([z.boolean(), z.string(), z.number()]).optional(),
    messageId: z.string().optional(),
    message_id: z.string().optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => (d.phone ?? d.from ?? "").trim().length >= 8, {
    message: "Indicá phone o from con el número.",
  });

function keyFromRequest(req: NextRequest, body: z.infer<typeof bodySchema>): string | undefined {
  return (
    req.headers.get("x-api-key")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    body.api_key ||
    body.apiKey ||
    body.key ||
    body.token
  );
}

type TurnParams = Parameters<typeof handleWhatsAppTurn>[0];

export async function handleWhatsAppTurnFailClosed(
  params: TurnParams,
  deps = {
    handleTurn: handleWhatsAppTurn,
    sendMessage: sendWhatsAppMessage,
  },
) {
  try {
    return await deps.handleTurn(params);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[whatsapp/turn] Error interno; respuesta fail-closed:", detail);

    let fallbackSent = false;
    try {
      await deps.sendMessage({
        number: params.rawPhone,
        message: TURN_FAILURE_MESSAGE,
      });
      fallbackSent = true;
    } catch (sendError) {
      console.error(
        "[whatsapp/turn] No se pudo entregar la respuesta fail-closed:",
        sendError instanceof Error ? sendError.message : String(sendError),
      );
    }

    return {
      ok: false,
      ok_s: "false",
      message: "",
      summaryText: "",
      deliveredMessage: fallbackSent ? TURN_FAILURE_MESSAGE : "",
      deliveredMessage_s: fallbackSent ? TURN_FAILURE_MESSAGE : "",
      skipResponse_s: "true",
      nextFlow: "reply",
      nextFlow_s: "reply",
      executor: "turn_error",
      executor_s: "turn_error",
      waSent_s: fallbackSent ? "true" : "false",
      waDelivery: fallbackSent ? "backend_fail_closed" : "failed",
      waDelivery_s: fallbackSent ? "backend_fail_closed" : "failed",
      error: "turn_failed",
    };
  }
}

/**
 * POST /api/whatsapp/turn
 * Fase 1 — cerebro único: contexto + ejecutor en un solo paso para BuilderBot Inicio.
 */
export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      { ok: false, ok_s: "false", error: "PULZE_API_KEY / BUILDERBOT_CONTEXT_API_KEY no configurado" },
      { status: 503 },
    );
  }

  const denied = requireBuilderBotContextAuth(req);
  if (denied) return denied;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, ok_s: "false", error: "Body inválido", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const apiKey = keyFromRequest(req, parsed.data);
  if (!validateContextSecret(apiKey)) {
    return NextResponse.json({ ok: false, ok_s: "false", error: "API key inválida" }, { status: 401 });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const body = (
    parsed.data.body ??
    parsed.data.rawText ??
    parsed.data.message ??
    ""
  ).trim();
  const aiImage = (parsed.data.aiImage ?? "").trim();
  const hasMediaRaw = parsed.data.hasMedia ?? parsed.data.has_media;
  const hasMedia =
    hasMediaRaw === true ||
    hasMediaRaw === "true" ||
    hasMediaRaw === "1" ||
    hasMediaRaw === 1;

  const messageId = (parsed.data.messageId ?? parsed.data.message_id ?? "").trim();

  const payload = await handleWhatsAppTurnFailClosed({
    rawPhone,
    body,
    aiImage: aiImage || undefined,
    hasMedia: hasMedia || undefined,
    messageId: messageId || undefined,
    apiKey: apiKey ?? "",
  });

  return NextResponse.json(payload, { status: 200 });
}
