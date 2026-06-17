import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { generateTicketCode } from "@/lib/tickets";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { detectPlate, formatPlateWithSpaces, normalizePlate } from "@/lib/wara";
import { consultarEstadoUnidades, resolveWaraSessionByPhone, type WaraUnidadEstado } from "@/lib/waraApi";
import { createHelpdeskTicket, getOdooConfig } from "@/lib/odooApi";

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    patente: z.string().min(2).optional(),
    plate: z.string().min(2).optional(),
    rawText: z.string().optional(),
    unidad: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional(),
    unidades: z.array(z.union([z.number(), z.string()])).optional(),
    patentes: z.array(z.string()).optional(),
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

function minutesAgo(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "sin dato";
  if (seconds < 90) return "menos de 2 minutos";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} horas`;
  return `${Math.round(hours / 24)} días`;
}

function summarizeUnit(unit: WaraUnidadEstado): string {
  const ign = unit.ultima_ignicion?.estado === true ? "encendida" : unit.ultima_ignicion?.estado === false ? "apagada" : "sin dato";
  const volt = typeof unit.alimentacion_externa?.voltaje === "number" ? `${unit.alimentacion_externa.voltaje}V` : "sin dato";
  return `Unidad ${unit.patente || unit.unidad}: último reporte hace ${minutesAgo(unit.ultimo_reporte?.hace_segundos)}, ignición ${ign}, alimentación ${volt}.`;
}

function normalizeLoosePlate(value: string): string {
  return normalizePlate(value)?.replace(/\s+/g, "") ?? "";
}

function parseRequestedPlates(body: z.infer<typeof bodySchema>): string[] {
  const explicit = body.patentes ?? [];
  const single = body.patente ?? body.plate ?? detectPlate(body.rawText ?? "") ?? "";
  const raw = [...explicit, single].filter((value) => value.trim().length > 0);
  return Array.from(
    new Set(
      raw
        .map((value) => formatPlateWithSpaces(value) ?? normalizePlate(value) ?? "")
        .filter((value) => value.length > 0)
    )
  );
}

// BuilderBot Cloud solo mapea el body (p.ej. {summaryText_s}) cuando el status es 2xx.
// Este endpoint lo consume exclusivamente BuilderBot: SIEMPRE respondemos 200 y dejamos
// el estado real en `ok` + el texto en `summaryText`.
const BB_STATUS = 200;
const MISSING_REPORT_TICKET_THRESHOLD_SECONDS = 60 * 60;

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
    return msgs.reverse().map((m) => m.text).filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

function extractLastPlateFromThread(text: string): string | null {
  const labeled = [...text.matchAll(/Patente:\s*([A-Za-z0-9 ]{5,12})/gi)];
  if (labeled.length) return normalizeLoosePlate(labeled[labeled.length - 1][1]);
  const unitMention = [...text.matchAll(/unidad\s+([A-Za-z0-9 ]{5,12})/gi)];
  if (unitMention.length) return normalizeLoosePlate(unitMention[unitMention.length - 1][1]);
  const plates = [...text.matchAll(/\b([A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})\b/gi)];
  if (plates.length) return normalizeLoosePlate(plates[plates.length - 1][1]);
  return null;
}

async function appendOutboundBotMessage(rawPhone: string, text: string, payload: Record<string, unknown>) {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return;
  const ticket = await prisma.ticket.findFirst({
    where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
    orderBy: { lastMessageAt: "desc" },
  });
  const targetTicket =
    ticket ??
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

function reportElapsedSeconds(unit: WaraUnidadEstado): number | null {
  const seconds = unit.ultimo_reporte?.hace_segundos;
  return typeof seconds === "number" && Number.isFinite(seconds) ? seconds : null;
}

async function findRecentMissingReportTicket(rawPhone: string, plate: string) {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return null;
  const ticket = await prisma.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
      incidentType: "MISSING_REPORT",
      title: { contains: plate, mode: "insensitive" },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  if (ticket) return { ticket, customer };

  return { ticket: null, customer };
}

async function createMissingReportTicket(params: {
  rawPhone: string;
  unit: WaraUnidadEstado;
  companyName: string;
  contactName: string;
  elapsedText: string;
}): Promise<{ ref: string; message: string; reused: boolean }> {
  const plate = normalizeLoosePlate(params.unit.patente || params.unit.unidad || "");
  const existing = await findRecentMissingReportTicket(params.rawPhone, plate);
  if (!existing?.customer) {
    return {
      ref: "",
      reused: false,
      message: `La unidad ${params.unit.patente || params.unit.unidad} está sin reporte hace ${params.elapsedText}. No pude registrar el caso automáticamente, te derivo con un asesor para revisarlo.`,
    };
  }

  if (existing.ticket) {
    return {
      ref: existing.ticket.code,
      reused: true,
      message: `La unidad ${params.unit.patente || params.unit.unidad} está sin reporte hace ${params.elapsedText}. Ya existe un caso abierto (${existing.ticket.code}) para que Atención al cliente lo revise.`,
    };
  }

  const title = `${plate} - Unidad sin reporte hace ${params.elapsedText}`;
  const localTicket = await prisma.ticket.create({
    data: {
      code: generateTicketCode(),
      customerId: existing.customer.id,
      contactName:
        params.contactName ||
        existing.customer.name?.trim() ||
        params.companyName ||
        "Sin nombre",
      title,
      status: "IN_PROGRESS",
      priority: "HIGH",
      category: "TECH_SUPPORT",
      incidentType: "MISSING_REPORT",
      channel: "WHATSAPP",
      aiSummary: `Unidad ${plate} sin reporte hace ${params.elapsedText}. Caso generado automáticamente por Atilio tras validar estado en Wara.`,
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: localTicket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: `Reclamo/consulta por unidad sin reporte: ${plate}`,
      rawPayload: {
        source: "wara_unidades_auto_ticket",
        plate,
        companyName: params.companyName,
        elapsedText: params.elapsedText,
        lastReportDate: params.unit.ultimo_reporte?.fecha ?? "",
        phone: params.rawPhone,
      } as Prisma.InputJsonObject,
    },
  });

  let ref = localTicket.code;
  const odooCfg = getOdooConfig();
  if (odooCfg) {
    try {
      const odoo = await createHelpdeskTicket(odooCfg, {
        subject: title,
        description: [
          `Unidad sin reporte detectada por Atilio / WhatsApp.`,
          `Empresa Wara: ${params.companyName}`,
          `Patente: ${plate}`,
          `Unidad: ${params.unit.unidad || ""}`,
          `Último reporte: hace ${params.elapsedText}`,
          params.unit.ultimo_reporte?.fecha ? `Fecha último reporte (Wara): ${params.unit.ultimo_reporte.fecha}` : "",
          `WhatsApp: ${params.rawPhone}`,
          `Ticket local: ${localTicket.code}`,
        ]
          .filter(Boolean)
          .join("\n"),
        customerName: params.contactName || existing.customer.name || params.companyName,
        customerPhone: params.rawPhone,
        companyName: params.companyName,
        priority: "HIGH",
      });
      ref = odoo.ref ?? String(odoo.ticketId);
      await prisma.ticket.update({
        where: { id: localTicket.id },
        data: {
          aiSummary: `Unidad ${plate} sin reporte hace ${params.elapsedText}. Odoo: ${ref}.`,
        },
      });
    } catch (error) {
      console.error(
        `[Unidades] No se pudo crear caso Odoo para ${plate}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    ref,
    reused: false,
    message: `La unidad ${params.unit.patente || params.unit.unidad} está sin reporte hace ${params.elapsedText}. Generé el caso N° ${ref} para que Atención al cliente lo revise. Te avisamos por este medio cualquier novedad.`,
  };
}

export async function POST(req: NextRequest) {
  if (!isCustomerContextAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado", summaryText: "No pude autenticar la consulta interna." },
      { status: BB_STATUS }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Body inválido", summaryText: "Faltan datos para consultar la unidad.", details: parsed.error.flatten() }, { status: BB_STATUS });
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json({ ok: false, error: "API key inválida o faltante", summaryText: "No pude autenticar la consulta interna." }, { status: BB_STATUS });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const threadText = await recentThreadText(rawPhone);
  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    return NextResponse.json(
      {
        ok: false,
        error: session.error,
        summaryText: session.requiresCompanySelection
          ? "Antes de consultar unidades necesito que elijas la empresa asociada a este número."
          : "No pude consultar las unidades en Wara. Te derivo con un agente para revisarlo.",
        requiresCompanySelection: session.requiresCompanySelection ?? false,
        testBlocked: session.testBlocked ?? false,
      },
      { status: BB_STATUS }
    );
  }

  const requestedPlates = parseRequestedPlates(parsed.data);
  const result = await consultarEstadoUnidades(session.sessionToken, requestedPlates);
  const wantedPlate = normalizeLoosePlate(
    parsed.data.patente ??
      parsed.data.plate ??
      detectPlate(parsed.data.rawText ?? "") ??
      extractLastPlateFromThread(threadText) ??
      detectPlate(threadText) ??
      ""
  );
  const filtered = wantedPlate
    ? result.unidades.filter((u) => {
        const plate = normalizeLoosePlate(u.patente);
        if (!plate) return false;
        return plate === wantedPlate || plate.includes(wantedPlate);
      })
    : result.unidades;
  const buildManyUnitsText = (units: WaraUnidadEstado[]): string => {
    const cliente = session.companyName || result.cliente || "este cliente";
    const max = 8;
    const labels = units
      .map((u) => (u.patente || u.unidad || "").trim())
      .filter((label) => label.length > 0);
    const head = labels.slice(0, max).join(", ");
    const remainder = labels.length - max;
    const suffix = remainder > 0 ? ` y ${remainder} más` : "";
    return `Tenés ${units.length} unidades en ${cliente}. Algunas: ${head}${suffix}. Decime una patente puntual para ver su estado.`;
  };
  let action: "none" | "observation" | "ticket" = "none";
  let ticketRef = "";
  let summaryText = !result.ok
    ? result.error || "No pude consultar las unidades en Wara."
    : filtered.length === 0
      ? `No encontré una unidad con esa patente para ${session.companyName || result.cliente || "este cliente"}.`
      : filtered.length === 1
        ? summarizeUnit(filtered[0])
        : buildManyUnitsText(filtered);

  if (result.ok && filtered.length === 1 && wantedPlate) {
    const unit = filtered[0];
    const elapsedSeconds = reportElapsedSeconds(unit);
    if (elapsedSeconds != null) {
      const elapsedText = minutesAgo(elapsedSeconds);
      if (elapsedSeconds < MISSING_REPORT_TICKET_THRESHOLD_SECONDS) {
        action = "observation";
        summaryText = `La unidad ${unit.patente || unit.unidad} tiene último reporte hace ${elapsedText}. Como está dentro del margen de observación, no genero ticket por ahora. El GPS puede reportar cada 10 minutos; te recomiendo volver a verificar en aproximadamente una hora.`;
      } else {
        action = "ticket";
        const created = await createMissingReportTicket({
          rawPhone,
          unit,
          companyName: session.companyName ?? result.cliente ?? "",
          contactName: session.contactName ?? "",
          elapsedText,
        });
        ticketRef = created.ref;
        summaryText = created.message;
      }
    }
  }

  await appendOutboundBotMessage(rawPhone, summaryText, {
    source: "wara_unidades_response",
    ok: result.ok,
    unidadesCount: filtered.length,
    companyName: session.companyName ?? result.cliente ?? "",
    action,
    ticketRef,
  });

  return NextResponse.json(
    {
      ...result,
      unidades: filtered,
      companyName: session.companyName ?? result.cliente ?? "",
      contactName: session.contactName ?? "",
      unidadesCount: filtered.length,
      summaryText,
      action,
      ticketRef,
    },
    { status: BB_STATUS }
  );
}
