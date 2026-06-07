import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { generateTicketCode } from "@/lib/tickets";
import { detectPlate, normalizePlate } from "@/lib/wara";
import { resolveCustomerByWaraPhone } from "@/lib/waraApi";
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
      rawPayload: payload as any,
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
  const plate = normalizePlate(parsed.data.patente ?? parsed.data.plate ?? detectPlate(text) ?? undefined);

  if (!plate) {
    const message = "Me falta la patente para registrar la solicitud de certificado.";
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
  const currentTicket = await prisma.ticket.findFirst({
    where: {
      customerId: resolution.customer.id,
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] },
      category: "SALES",
      incidentType: "CERTIFICATE_ISSUE",
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const title = `Certificado de monitoreo · ${plate}`;
  const ticket =
    currentTicket ??
    (await prisma.ticket.create({
      data: {
        code: generateTicketCode(),
        customerId: resolution.customer.id,
        contactName:
          resolution.customer.name?.trim() ||
          resolution.selectedCompanyName?.trim() ||
          "Sin nombre",
        title,
        status: "OPEN",
        priority: "NORMAL",
        category: "SALES",
        incidentType: "CERTIFICATE_ISSUE",
        channel: "WHATSAPP",
      },
    }));

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text,
      rawPayload: {
        source: "builderbot_certificados",
        companyName: company,
        plate,
        phone: rawPhone,
      },
    },
  });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      title,
      priority: "NORMAL",
      status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status,
      lastMessageAt: new Date(),
      aiSummary: `Solicitud de certificado de monitoreo para ${plate}. Cliente: ${company}.`,
    },
  });

  const responseMessage = `Perfecto, deje registrada la solicitud de certificado para ${company}, patente ${plate}. Caso ${ticket.code}. Queda pendiente de validacion interna.`;

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: responseMessage,
      rawPayload: {
        source: "wara_certificados",
        generatedBy: "api_response",
        plate,
      },
    },
  });

  return NextResponse.json(
    {
      ok: true,
      ok_s: "true",
      ticketCode: ticket.code,
      ticketId: ticket.id,
      plate,
      companyName: company,
      message: responseMessage,
    },
    { status: BB_STATUS }
  );
}
