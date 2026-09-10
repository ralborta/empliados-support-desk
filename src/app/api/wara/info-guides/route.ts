import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isCustomerContextAuthConfigured,
  requireBuilderBotContextAuth,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { prisma } from "@/lib/db";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { buildGroundedInfoGuideReplyWithMeta, detectInfoGuideKind } from "@/lib/infoGuideReplies";
import type { PlatformKnowledgeInterpret } from "@/lib/infoGuideInterpretAI";
import { recentThreadTextForPhone } from "@/lib/conversationThread";
import {
  looksLikeFlowControlCommand,
  looksLikeSoftFlowRestart,
  looksLikeInfoGuideModulePick,
  looksLikeTechnicalSupportRequest,
  threadHasGenericPlatformMenuOffer,
} from "@/lib/waraApi";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    rawText: z.string().optional(),
    body: z.string().optional(),
    guide: z
      .enum([
        "opciones",
        "unidades",
        "mantenimiento",
        "transporte_publico",
        "cisternas",
        "combustible",
        "hojas_de_ruta",
      ])
      .optional(),
    articleIds: z.array(z.string()).optional(),
    need: z
      .enum(["definition", "procedure", "troubleshoot", "execute", "ambiguous"])
      .optional(),
    executionRequest: z.boolean().optional(),
    clarifyQuestion: z.string().optional(),
    api_key: z.string().optional(),
    apiKey: z.string().optional(),
  })
  .refine((d) => (d.phone ?? d.from ?? "").trim().length >= 8, {
    message: "Indicá phone o from.",
  });

const BB_STATUS = 200;

async function appendOutboundBotMessage(rawPhone: string, text: string, payload: Record<string, unknown>) {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return;
  const ticket = await prisma.ticket.findFirst({
    where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!ticket) return;
  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      rawPayload: payload as never,
    },
  });
}

/** Último mensaje saliente del bot en el ticket abierto (para no repetir la misma guía). */
async function lastBotMessage(rawPhone: string): Promise<string | null> {
  try {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (!customer) return null;
    const ticket = await prisma.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!ticket) return null;
    const message = await prisma.ticketMessage.findFirst({
      where: { ticketId: ticket.id, direction: "OUTBOUND", from: "BOT" },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    });
    return message?.text ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json({ ok: false, ok_s: "false", error: "Auth no configurada" }, { status: 503 });
  }
  const denied = requireBuilderBotContextAuth(req);
  if (denied) return denied;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, ok_s: "false", message: "Body inválido", details: parsed.error.flatten() },
      { status: BB_STATUS },
    );
  }

  const apiKey =
    req.headers.get("x-api-key")?.trim() ||
    parsed.data.api_key ||
    parsed.data.apiKey ||
    "";
  if (!validateContextSecret(apiKey)) {
    return NextResponse.json({ ok: false, ok_s: "false", error: "API key inválida" }, { status: 401 });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const rawText = (parsed.data.rawText ?? parsed.data.body ?? "").trim();

  if (looksLikeFlowControlCommand(rawText) || looksLikeSoftFlowRestart(rawText)) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        skipResponse_s: "true",
        flowComplete_s: "true",
        informational: true,
        informational_s: "true",
      },
      { status: BB_STATUS },
    );
  }

  if (looksLikeTechnicalSupportRequest(rawText)) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        skipResponse_s: "true",
        flowComplete_s: "true",
        delegateTo: "odoo_ticket",
        delegateTo_s: "odoo_ticket",
      },
      { status: BB_STATUS },
    );
  }

  if (rawPhone && !allowPhoneRequest(rawPhone, 20)) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "Recibí muchas solicitudes seguidas. Esperá un momento e intentá de nuevo.",
      },
      { status: BB_STATUS },
    );
  }

  const { isCisternasKbEnabled } = await import("@/lib/cisternasKnowledge");
  const { isCombustibleKbEnabled } = await import("@/lib/combustibleKnowledge");
  const { isHojasRutaKbEnabled } = await import("@/lib/hojasRutaKnowledge");
  const requestedGuide = parsed.data.guide;
  const cisternasGuideIgnored =
    requestedGuide === "cisternas" && !isCisternasKbEnabled();
  const combustibleGuideIgnored =
    requestedGuide === "combustible" && !isCombustibleKbEnabled();
  const hojasRutaCorpusOff =
    requestedGuide === "hojas_de_ruta" && !isHojasRutaKbEnabled();
  // Cisternas/Combustible: flag off = ignorar kind. HR: reconocer kind aunque corpus off.
  const optInGuideIgnored = cisternasGuideIgnored || combustibleGuideIgnored;
  const guide = optInGuideIgnored ? undefined : requestedGuide;
  const kind = guide ?? detectInfoGuideKind(rawText);
  const [previousMessage, threadText] = await Promise.all([
    lastBotMessage(rawPhone),
    recentThreadTextForPhone(rawPhone),
  ]);

  // Si venía guide opt-in con flag off, sembramos interpret para no perder diagnóstico.
  const ignoredReason = cisternasGuideIgnored
    ? "cisternas_flag_off_ignored_guide"
    : combustibleGuideIgnored
      ? "combustible_flag_off_ignored_guide"
      : hojasRutaCorpusOff
        ? "hojas_ruta_module_disabled"
        : null;
  const seededInterpret: PlatformKnowledgeInterpret | null =
    guide ||
    parsed.data.need ||
    parsed.data.articleIds?.length ||
    optInGuideIgnored ||
    hojasRutaCorpusOff
      ? {
          route: "info_guides",
          guideKind: (hojasRutaCorpusOff
            ? "hojas_de_ruta"
            : ((guide as PlatformKnowledgeInterpret["guideKind"]) ?? null)),
          need: (parsed.data.need as PlatformKnowledgeInterpret["need"]) ?? "procedure",
          articleIds: hojasRutaCorpusOff ? [] : (parsed.data.articleIds ?? []),
          clarifyQuestion: parsed.data.clarifyQuestion?.trim() || null,
          executionRequest: hojasRutaCorpusOff
            ? false
            : parsed.data.executionRequest === true,
          confidence: 1,
          reason: ignoredReason ?? "seeded_from_turn",
        }
      : null;

  const grounded = await buildGroundedInfoGuideReplyWithMeta(
    rawText,
    kind ?? undefined,
    previousMessage,
    threadText,
    seededInterpret,
  );
  const message = grounded.message;
  const guideKind = grounded.guideKind;
  const interpret = grounded.interpret
    ? {
        ...grounded.interpret,
        reason:
          optInGuideIgnored && !grounded.interpret.reason
            ? ignoredReason!
            : grounded.interpret.reason,
      }
    : grounded.interpret;
  const fallback =
    cisternasGuideIgnored && !grounded.fallback
      ? "cisternas_flag_off"
      : combustibleGuideIgnored && !grounded.fallback
        ? "combustible_flag_off"
        : hojasRutaCorpusOff && !grounded.fallback
          ? "hojas_ruta_flag_off"
          : grounded.fallback;

  const { logPlatformKbTurn } = await import("@/lib/infoGuideInterpretAI");
  logPlatformKbTurn({
    phone: rawPhone,
    executor: "info_guides",
    guideKind: guideKind ?? kind ?? null,
    need: interpret?.need ?? null,
    articleIds: interpret?.articleIds ?? [],
    confidence: interpret?.confidence ?? null,
    reason: interpret?.reason ?? ignoredReason,
    fallback,
    source: "wara_info_guides_route",
  });

  await appendOutboundBotMessage(rawPhone, message, {
    source: "wara_info_guides",
    guideKind: guideKind ?? kind ?? "general",
    rawText,
    interpretNeed: interpret?.need ?? null,
    interpretArticles: interpret?.articleIds ?? [],
    interpretReason: interpret?.reason ?? null,
    interpretConfidence: interpret?.confidence ?? null,
    kbFallback: fallback,
  });

  return NextResponse.json(
    {
      ok: true,
      ok_s: "true",
      message,
      guideKind: guideKind ?? kind ?? "",
      interpretNeed: interpret?.need ?? "",
      interpretArticles: interpret?.articleIds ?? [],
      interpretConfidence: interpret?.confidence ?? null,
      interpretReason: interpret?.reason ?? "",
      kbFallback: fallback ?? "",
      informational: true,
      informational_s: "true",
      flowComplete_s: "true",
    },
    { status: BB_STATUS },
  );
}
