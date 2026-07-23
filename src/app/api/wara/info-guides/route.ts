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
import { buildGroundedInfoGuideReply, detectInfoGuideKind } from "@/lib/infoGuideReplies";
import { recentThreadTextForPhone } from "@/lib/conversationThread";
import {
  looksLikeFlowControlCommand,
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
    guide: z.enum(["opciones", "unidades", "mantenimiento"]).optional(),
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

  if (looksLikeFlowControlCommand(rawText)) {
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

  const kind = parsed.data.guide ?? detectInfoGuideKind(rawText);
  const [previousMessage, threadText] = await Promise.all([
    lastBotMessage(rawPhone),
    recentThreadTextForPhone(rawPhone),
  ]);
  const message = await buildGroundedInfoGuideReply(rawText, kind ?? undefined, previousMessage, threadText);

  await appendOutboundBotMessage(rawPhone, message, {
    source: "wara_info_guides",
    guideKind: kind ?? "general",
    rawText,
  });

  return NextResponse.json(
    {
      ok: true,
      ok_s: "true",
      message,
      guideKind: kind ?? "",
      informational: true,
      informational_s: "true",
      flowComplete_s: "true",
    },
    { status: BB_STATUS },
  );
}
