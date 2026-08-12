import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isCustomerContextAuthConfigured,
  requireBuilderBotContextAuth,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { handleWhatsAppTurn } from "@/lib/whatsappTurn";
import { resolveV1HotfixCanary, v1HotfixCanaryStatus } from "@/lib/v1HotfixCanary";

export const maxDuration = 60;

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    body: z.string().optional(),
    rawText: z.string().optional(),
    message: z.string().optional(),
    messageId: z.string().min(1).optional(),
    message_id: z.string().min(1).optional(),
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

  const canary = resolveV1HotfixCanary(rawPhone);
  if (canary.action === "reject") {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        error: "Hotfix canary mal configurado (allowlist vacía o inválida)",
        canary: v1HotfixCanaryStatus(),
      },
      { status: 503 },
    );
  }
  if (canary.action === "proxy") {
    const proxyRes = await fetch(`${canary.fallbackUrl}/api/whatsapp/turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey ?? "",
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
    const proxyJson = await proxyRes.json().catch(() => ({
      ok: false,
      ok_s: "false",
      error: "Fallback producción no respondió JSON",
    }));
    return NextResponse.json(proxyJson, {
      status: proxyRes.status,
      headers: {
        "x-wara-v1-canary": "proxied_to_production",
        "x-wara-v1-canary-fallback": canary.fallbackUrl,
      },
    });
  }

  const payload = await handleWhatsAppTurn({
    rawPhone,
    body,
    apiKey: apiKey ?? "",
    inboundMessageId:
      parsed.data.messageId?.trim() ||
      parsed.data.message_id?.trim() ||
      req.headers.get("x-message-id")?.trim() ||
      undefined,
  });

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "x-wara-v1-canary": canary.reason === "allowlisted" ? "allowlisted" : "off",
      "x-wara-v1-hotfix-sha": v1HotfixCanaryStatus().commitSha ?? "",
    },
  });
}
