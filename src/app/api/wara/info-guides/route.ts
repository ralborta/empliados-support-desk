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
import { buildGroundedInfoGuideReplyWithMeta } from "@/lib/infoGuideReplies";
import type { PlatformKnowledgeInterpret } from "@/lib/infoGuideInterpretAI";
import { recentThreadTextForPhone } from "@/lib/conversationThread";
import {
  looksLikeFlowControlCommand,
  looksLikeSoftFlowRestart,
  looksLikeInfoGuideModulePick,
  looksLikeTechnicalSupportRequest,
  looksLikeChangeCompanyRequest,
  resetCustomerCompanyMenu,
  threadHasGenericPlatformMenuOffer,
} from "@/lib/waraApi";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";
import { looksLikeChangeCompanyRequestHybrid } from "@/lib/whatsappAdminIntentAI";

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
        "puntos_de_interes",
        "utilidades_bloque_2",
        "informes",
        "alertas",
        "paneles",
      ])
      .optional(),
    articleIds: z.array(z.string()).optional(),
    need: z
      .enum(["definition", "procedure", "troubleshoot", "execute", "ambiguous"])
      .optional(),
    executionRequest: z.boolean().optional(),
    clarifyQuestion: z.string().optional(),
    category: z.string().optional(),
    reportId: z.string().optional(),
    normalTarget: z
      .enum(["operational_fuel", "live_unit", "assistant_identity"])
      .optional(),
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

  // Bug prod 2026-09-17: con lastGuide Paneles, «reiniciar empresa» caía a info_guides
  // y reinyectaba Alarmas en vez de abrir el menú multiempresa.
  if (
    looksLikeChangeCompanyRequest(rawText) ||
    (await looksLikeChangeCompanyRequestHybrid(rawText))
  ) {
    const reset = await resetCustomerCompanyMenu(prisma, rawPhone);
    await appendOutboundBotMessage(rawPhone, reset.message, {
      source: "wara_info_guides_change_company",
      rawText,
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        message: reset.message,
        changeCompany_s: "true",
        requiresCompanySelection: reset.requiresCompanySelection,
        requiresCompanySelection_s: reset.requiresCompanySelection ? "true" : "false",
        informational: true,
        informational_s: "true",
        flowComplete_s: "true",
      },
      { status: BB_STATUS },
    );
  }

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
  const { isPuntosInteresKbEnabled } = await import("@/lib/puntosInteresKnowledge");
  const { isUtilidadesBloque2KbEnabled } = await import(
    "@/lib/utilidadesBloque2Knowledge"
  );
  const { isInformesKbEnabled } = await import("@/lib/informesKnowledge");
  const { isAlertasKbEnabled } = await import("@/lib/alertasKnowledge");
  const { isPanelesKbEnabled } = await import("@/lib/panelesKnowledge");
  const requestedGuide = parsed.data.guide;
  const cisternasGuideIgnored =
    requestedGuide === "cisternas" && !isCisternasKbEnabled();
  const combustibleGuideIgnored =
    requestedGuide === "combustible" && !isCombustibleKbEnabled();
  const hojasRutaCorpusOff =
    requestedGuide === "hojas_de_ruta" && !isHojasRutaKbEnabled();
  const puntosInteresCorpusOff =
    requestedGuide === "puntos_de_interes" && !isPuntosInteresKbEnabled();
  const informesCorpusOff =
    requestedGuide === "informes" && !isInformesKbEnabled();
  const alertasCorpusOff =
    requestedGuide === "alertas" && !isAlertasKbEnabled();
  const panelesCorpusOff =
    requestedGuide === "paneles" && !isPanelesKbEnabled();
  const utilidadesBloque2GuideIgnored =
    requestedGuide === "utilidades_bloque_2" && !isUtilidadesBloque2KbEnabled();
  // Cisternas/Combustible/U2: flag off = ignorar kind. HR/PI/Informes/Alertas/Paneles: reconocer kind aunque corpus off.
  const optInGuideIgnored =
    cisternasGuideIgnored || combustibleGuideIgnored || utilidadesBloque2GuideIgnored;
  const guide = optInGuideIgnored ? undefined : requestedGuide;
  // Solo una selección explícita puede fijar la familia. Para texto libre,
  // buildGroundedInfoGuideReplyWithMeta usa el intérprete semántico y conserva
  // detectInfoGuideKind únicamente como fallback offline.
  const kind = guide ?? null;
  const [previousMessage, threadText] = await Promise.all([
    lastBotMessage(rawPhone),
    recentThreadTextForPhone(rawPhone),
  ]);

  // Si venía guide opt-in con flag off, sembramos interpret para no perder diagnóstico.
  const ignoredReason = cisternasGuideIgnored
    ? "cisternas_flag_off_ignored_guide"
    : combustibleGuideIgnored
      ? "combustible_flag_off_ignored_guide"
      : utilidadesBloque2GuideIgnored
        ? "utilidades_bloque2_flag_off_ignored_guide"
      : hojasRutaCorpusOff
        ? "hojas_ruta_module_disabled"
        : puntosInteresCorpusOff
          ? "puntos_interes_module_disabled"
          : informesCorpusOff
            ? "informes_module_disabled"
          : alertasCorpusOff
            ? "alertas_module_disabled"
          : panelesCorpusOff
            ? "paneles_module_disabled"
          : null;
  const seededInterpret: PlatformKnowledgeInterpret | null =
    guide ||
    parsed.data.need ||
    parsed.data.articleIds?.length ||
    parsed.data.normalTarget ||
    optInGuideIgnored ||
    hojasRutaCorpusOff ||
    puntosInteresCorpusOff ||
    informesCorpusOff ||
    alertasCorpusOff ||
    panelesCorpusOff
      ? {
          route: "info_guides",
          guideKind: (hojasRutaCorpusOff
            ? "hojas_de_ruta"
            : puntosInteresCorpusOff
              ? "puntos_de_interes"
              : informesCorpusOff
                ? "informes"
              : alertasCorpusOff
                ? "alertas"
              : panelesCorpusOff
                ? "paneles"
              : ((guide as PlatformKnowledgeInterpret["guideKind"]) ?? null)),
          need: (parsed.data.need as PlatformKnowledgeInterpret["need"]) ?? "procedure",
          articleIds:
            hojasRutaCorpusOff ||
            puntosInteresCorpusOff ||
            informesCorpusOff ||
            alertasCorpusOff ||
            panelesCorpusOff
              ? []
              : (parsed.data.articleIds ?? []),
          clarifyQuestion: parsed.data.clarifyQuestion?.trim() || null,
          executionRequest:
            hojasRutaCorpusOff ||
            puntosInteresCorpusOff ||
            informesCorpusOff ||
            alertasCorpusOff ||
            panelesCorpusOff
              ? false
              : parsed.data.executionRequest === true,
          confidence: 1,
          reason: ignoredReason ?? "seeded_from_turn",
          category: parsed.data.category?.trim() || null,
          reportId: parsed.data.reportId?.trim() || null,
          normalTarget: parsed.data.normalTarget ?? null,
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
          : puntosInteresCorpusOff && !grounded.fallback
            ? "puntos_interes_flag_off"
          : informesCorpusOff && !grounded.fallback
            ? "informes_flag_off"
          : alertasCorpusOff && !grounded.fallback
            ? "alertas_flag_off"
          : panelesCorpusOff && !grounded.fallback
            ? "paneles_flag_off"
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
      category: interpret?.category ?? "",
      reportId: interpret?.reportId ?? "",
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
