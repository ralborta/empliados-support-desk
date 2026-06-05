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

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    servicio: z.string().optional(),
    service: z.string().optional(),
    detalle: z.string().optional(),
    detail: z.string().optional(),
    patente: z.string().optional(),
    plate: z.string().optional(),
    rawText: z.string().optional(),
    prioridad: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    api_key: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((d) => (d.phone ?? d.from ?? "").trim().length >= 8, {
    message: "Indica phone o from con el numero.",
  });

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

const BB_STATUS = 200;
const OPEN_THREAD_STATUSES: Array<"OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER"> = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
];

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

function inferService(raw: string): string {
  const text = raw.toLowerCase();
  if (/(correctiv|aver[ií]a|falla|rotura)/.test(text)) return "Correctivo";
  if (/(rfid|neum[aá]tic|cubierta)/.test(text)) return "Neumaticos RFID";
  if (/(plan|preventiv)/.test(text)) return "Plan de mantenimiento";
  if (/(tarea|orden de trabajo)/.test(text)) return "Tarea de mantenimiento";
  return "Gestion de mantenimiento";
}

function inferPriority(raw: string): Priority {
  const text = raw.toLowerCase();
  if (/(urgente|cr[ií]tic|parad|detenid)/.test(text)) return "URGENT";
  if (/(correctiv|falla|no funciona|error)/.test(text)) return "HIGH";
  return "NORMAL";
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
        message: "Faltan datos para registrar la gestion de mantenimiento.",
        error: "Body invalido",
        details: parsed.error.flatten(),
      },
      { status: BB_STATUS }
    );
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json(
      { ok: false, ok_s: "false", message: "No pude autenticar la solicitud interna.", error: "API key invalida o faltante" },
      { status: BB_STATUS }
    );
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const resolution = await resolveCustomerByWaraPhone(prisma, rawPhone);
  if (!resolution.registered || !resolution.customer) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "No pude validar este numero en Wara para gestionar mantenimiento.",
        requiresCompanySelection: false,
        requiresCompanySelection_s: "false",
        testBlocked: resolution.testBlocked ?? false,
        testBlocked_s: resolution.testBlocked ? "true" : "false",
      },
      { status: BB_STATUS }
    );
  }

  if (resolution.requiresCompanySelection) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "Antes de continuar, necesito que elijas la empresa asociada a este numero.",
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
    parsed.data.servicio?.trim() ||
    parsed.data.service?.trim() ||
    "Solicitud de gestion de mantenimiento";
  const service = inferService(`${parsed.data.servicio ?? parsed.data.service ?? ""} ${text}`);
  const priority = parsed.data.prioridad ?? parsed.data.priority ?? inferPriority(text);
  const plate = normalizePlate(parsed.data.patente ?? parsed.data.plate ?? detectPlate(text) ?? undefined);
  const title = `${service}${plate ? ` · ${plate}` : ""}`;

  const currentTicket = await prisma.ticket.findFirst({
    where: {
      customerId: resolution.customer.id,
      status: { in: OPEN_THREAD_STATUSES },
      category: "TECH_SUPPORT",
    },
    orderBy: { lastMessageAt: "desc" },
  });

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
        priority,
        category: "TECH_SUPPORT",
        incidentType: "GENERAL_TECH",
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
        source: "builderbot_mantenimiento_operativo",
        service,
        companyName: resolution.selectedCompanyName ?? "",
        plate: plate ?? "",
        phone: rawPhone,
      },
    },
  });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      title,
      priority,
      status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status,
      lastMessageAt: new Date(),
      aiSummary: `${service}${plate ? ` para ${plate}` : ""}. Cliente: ${
        resolution.selectedCompanyName || resolution.customer.name || "sin nombre"
      }.`,
    },
  });

  const company = resolution.selectedCompanyName || resolution.customer.companyName || "tu empresa";
  return NextResponse.json(
    {
      ok: true,
      ok_s: "true",
      ticketCode: ticket.code,
      ticketId: ticket.id,
      service,
      plate: plate ?? "",
      companyName: company,
      message: `Perfecto, ya registre tu solicitud de ${service.toLowerCase()} para ${company}. Caso ${ticket.code}.`,
    },
    { status: BB_STATUS }
  );
}
