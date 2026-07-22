import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isCustomerContextAuthConfigured,
  requireBuilderBotContextAuth,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { handleWhatsAppTurn } from "@/lib/whatsappTurn";

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

  const payload = await handleWhatsAppTurn({
    rawPhone,
    body,
    apiKey: apiKey ?? "",
  });

  return NextResponse.json(payload, { status: 200 });
}
