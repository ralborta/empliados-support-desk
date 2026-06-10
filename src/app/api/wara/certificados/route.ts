import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { detectPlate, formatPlateWithSpaces, normalizePlate } from "@/lib/wara";
import {
  obtenerCertificadoCobertura,
  resolveCustomerByWaraPhone,
  resolveWaraSessionByPhone,
} from "@/lib/waraApi";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    patente: z.string().optional(),
    plate: z.string().optional(),
    rawText: z.string().optional(),
    detalle: z.string().optional(),
    detail: z.string().optional(),
    confirm: z.string().optional(),
    confirmation: z.string().optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => (d.phone ?? d.from ?? "").trim().length >= 8, {
    message: "Indica phone o from con el numero.",
  });

const BB_STATUS = 200;

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

function isConfirmed(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const t = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (!t) return false;
  return new Set([
    "confirmo",
    "confirmar",
    "confirmado",
    "confirma",
    "siconfirmo",
    "si",
    "sii",
    "sip",
    "dale",
    "dalesi",
    "sidale",
    "ok",
    "oka",
    "okey",
    "okay",
    "listo",
    "correcto",
    "deacuerdo",
    "hacelo",
    "adelante",
    "avanza",
    "vamos",
    "perfecto",
  ]).has(t);
}

async function recentThreadText(rawPhone: string): Promise<string> {
  try {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (!customer) return "";
    const ticket = await prisma.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!ticket) return "";
    const msgs = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { text: true },
    });
    return msgs
      .reverse()
      .map((m) => m.text)
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function extractPlateFromCertificateSummary(text: string): string | null {
  const match = text.match(/Patente:\s*([A-Za-z0-9 ]{5,12})/);
  return normalizePlate(match?.[1] ?? detectPlate(text) ?? undefined);
}

async function appendOutboundBotMessage(rawPhone: string, text: string, payload: Record<string, unknown>) {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return;
  const openTicket = await prisma.ticket.findFirst({
    where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
    orderBy: { lastMessageAt: "desc" },
  });
  const targetTicket =
    openTicket ??
    (await prisma.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    }));
  if (!targetTicket) return;
  const recent = await prisma.ticketMessage.findFirst({
    where: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
  });
  if (recent) return;
  await prisma.ticketMessage.create({
    data: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      rawPayload: payload as Prisma.InputJsonObject,
    },
  });
  await prisma.ticket.update({
    where: { id: targetTicket.id },
    data: { lastMessageAt: new Date(), status: "WAITING_CUSTOMER" },
  });
}

export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "No pude autenticar la solicitud interna.",
        error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado",
      },
      { status: BB_STATUS }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "Faltan datos para registrar la solicitud de certificado.",
        error: "Body invalido",
        details: parsed.error.flatten(),
      },
      { status: BB_STATUS }
    );
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "No pude autenticar la solicitud interna.",
        error: "API key invalida o faltante",
      },
      { status: BB_STATUS }
    );
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const resolution = await resolveCustomerByWaraPhone(prisma, rawPhone);
  if (!resolution.registered || !resolution.customer) {
    const message = "No pude validar este numero en Wara para gestionar el certificado.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_certificados",
      errorStage: "customer_validation",
      testBlocked: resolution.testBlocked ?? false,
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message,
        requiresCompanySelection: false,
        requiresCompanySelection_s: "false",
        testBlocked: resolution.testBlocked ?? false,
        testBlocked_s: resolution.testBlocked ? "true" : "false",
      },
      { status: BB_STATUS }
    );
  }

  if (resolution.requiresCompanySelection) {
    const message = "Antes de continuar, necesito que elijas la empresa asociada a este numero.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_certificados",
      errorStage: "requires_company_selection",
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message,
        requiresCompanySelection: true,
        requiresCompanySelection_s: "true",
      },
      { status: BB_STATUS }
    );
  }

  const text =
    parsed.data.rawText?.trim() ||
    parsed.data.detalle?.trim() ||
    parsed.data.detail?.trim() ||
    "Solicitud de certificado";
  const threadText = await recentThreadText(rawPhone);
  const plate = normalizePlate(
    parsed.data.patente ??
      parsed.data.plate ??
      detectPlate(text) ??
      extractPlateFromCertificateSummary(threadText) ??
      undefined
  );
  const confirmation = parsed.data.confirm ?? parsed.data.confirmation;

  if (!plate) {
    const message =
      "No pude reconocer una patente completa. Enviamela con formato AA123BB o ABC123 para registrar la solicitud de certificado.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_certificados",
      errorStage: "missing_plate",
      phone: rawPhone,
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message,
        missing: ["patente"],
        missing_s: "patente",
      },
      { status: BB_STATUS }
    );
  }

  const company = resolution.selectedCompanyName || resolution.customer.companyName || "tu empresa";
  if (!isConfirmed(confirmation)) {
    const message = `Voy a generar el certificado de cobertura:\nPatente: ${plate}\nEmpresa: ${company}\n\nSi esta correcto, responde CONFIRMO para solicitarlo a Wara.`;
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_certificados",
      stage: "confirmation_required",
      plate,
      companyName: company,
      phone: rawPhone,
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        confirmationRequired: true,
        confirmationRequired_s: "true",
        message,
        plate,
        companyName: company,
      },
      { status: BB_STATUS }
    );
  }

  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    const message = session.requiresCompanySelection
      ? "Antes de continuar, necesito que elijas la empresa asociada a este numero."
      : "No pude validar la sesión con Wara para generar el certificado. Intentá nuevamente en unos minutos.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_certificados",
      errorStage: "session_resolution",
      detail: session.error ?? "",
      plate,
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message,
        requiresCompanySelection: session.requiresCompanySelection ?? false,
        requiresCompanySelection_s: session.requiresCompanySelection ? "true" : "false",
        error: session.error,
      },
      { status: BB_STATUS }
    );
  }

  const plateForWara = formatPlateWithSpaces(plate) ?? plate;
  const result = await obtenerCertificadoCobertura(session.sessionToken, plateForWara);
  if (!result.ok) {
    const message = `No pude generar el certificado de cobertura para ${plate}. ${result.error ?? "Wara no completó la solicitud."}`;
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_certificados",
      errorStage: "certificadocobertura",
      status: result.status,
      error: result.error ?? "",
      plate,
      companyName: company,
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message,
        plate,
        companyName: company,
        error: result.error,
      },
      { status: BB_STATUS }
    );
  }

  const certUrl = result.downloadUrl ?? result.url;
  const responseMessage = certUrl
    ? `Perfecto, generé el certificado de cobertura para ${company}, patente ${plate}.\n${certUrl}`
    : `Perfecto, generé el certificado de cobertura para ${company}, patente ${plate}. ${result.message ?? "La solicitud fue procesada por Wara."}`;

  await appendOutboundBotMessage(rawPhone, responseMessage, {
    source: "wara_certificados",
    generatedBy: "wara_certificadocobertura",
    plate,
    companyName: company,
    status: result.status,
    hasUrl: Boolean(certUrl),
    hasCertificatePayload: Boolean(result.certificado),
    raw: result.raw ?? {},
  });

  return NextResponse.json(
    {
      ok: true,
      ok_s: "true",
      plate,
      companyName: company,
      url: certUrl,
      filename: result.filename,
      message: responseMessage,
    },
    { status: BB_STATUS }
  );
}
