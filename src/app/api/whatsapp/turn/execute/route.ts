import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isCustomerContextAuthConfigured,
  requireBuilderBotContextAuth,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { persistCustomerBotReply } from "@/lib/customerTicketInquiry";
import { runTurnExecutorPhase } from "@/lib/whatsappTurnExecutor";
import { sendWhatsAppTextWithOptionalMedia } from "@/lib/whatsappMediaDelivery";

export const maxDuration = 120;

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    body: z.string().optional(),
    rawText: z.string().optional(),
    message: z.string().optional(),
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

/**
 * Segunda fase del turno — corre el ejecutor (Wara) y envía WhatsApp por API.
 * BBC no espera este endpoint (evita timeout de 60s).
 */
export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "Auth no configurada" }, { status: 503 });
  }

  const denied = requireBuilderBotContextAuth(req);
  if (denied) return denied;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const apiKey = keyFromRequest(req, parsed.data);
  if (!validateContextSecret(apiKey)) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const selectionText = (
    parsed.data.body ??
    parsed.data.rawText ??
    parsed.data.message ??
    ""
  ).trim();
  if (!selectionText) {
    return NextResponse.json({ ok: false, error: "Mensaje vacío" }, { status: 400 });
  }

  try {
    const result = await runTurnExecutorPhase({
      rawPhone,
      selectionText,
      apiKey: apiKey ?? "",
    });
    if (result.message || result.mediaUrl) {
      await sendWhatsAppTextWithOptionalMedia({
        number: rawPhone,
        message: result.message,
        mediaUrl: result.mediaUrl,
      });
      if (result.message) {
        await persistCustomerBotReply(rawPhone, result.message, {
          source: "whatsapp_turn_execute",
          executor: result.executor,
          waDelivery: "backend_deferred",
        }).catch(() => undefined);
      }
    }
    return NextResponse.json({
      ok: result.ok,
      ok_s: result.ok ? "true" : "false",
      executor: result.executor,
      executor_s: result.executor,
      message: result.message,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[whatsappTurn/execute]", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
