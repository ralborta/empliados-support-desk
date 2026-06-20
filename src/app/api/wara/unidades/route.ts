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
import { detectPlate, extractLastPlateFromThread, formatPlateWithSpaces, hasPendingMaintenancePlateRequest, normalizePlate, threadTextSinceCompanySelection } from "@/lib/wara";
import {
  consultarEstadoUnidades,
  looksLikeCompanySelection,
  resolveWaraSessionByPhone,
  type WaraUnidadEstado,
} from "@/lib/waraApi";
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
  const pos = minutesAgo(unit.ultima_posicion?.hace_segundos);
  return `Unidad ${unit.patente || unit.unidad}: último reporte hace ${minutesAgo(unit.ultimo_reporte?.hace_segundos)}, última posición hace ${pos}, ignición ${ign}, alimentación ${volt}.`;
}

/** Margen: si la posición es mucho más vieja que el reporte, el equipo no está reportando bien. */
const POSITION_REPORT_DRIFT_SECONDS = 20 * 60;

type ReportingAssessment =
  | { status: "ok"; reportElapsed: number }
  | { status: "missing_report"; reportElapsed: number }
  | { status: "stale_position"; reportElapsed: number; positionElapsed: number | null; reason: string };

function assessUnitReporting(unit: WaraUnidadEstado): ReportingAssessment | null {
  const reportElapsed = reportElapsedSeconds(unit);
  if (reportElapsed == null) return null;

  const positionElapsed =
    typeof unit.ultima_posicion?.hace_segundos === "number" &&
    Number.isFinite(unit.ultima_posicion.hace_segundos)
      ? unit.ultima_posicion.hace_segundos
      : null;

  if (reportElapsed >= MISSING_REPORT_TICKET_THRESHOLD_SECONDS) {
    return { status: "missing_report", reportElapsed };
  }

  if (positionElapsed == null) {
    return {
      status: "stale_position",
      reportElapsed,
      positionElapsed: null,
      reason: "no figura última posición en Wara",
    };
  }

  if (positionElapsed >= MISSING_REPORT_TICKET_THRESHOLD_SECONDS) {
    return {
      status: "stale_position",
      reportElapsed,
      positionElapsed,
      reason: `la última posición es de hace ${minutesAgo(positionElapsed)}`,
    };
  }

  if (positionElapsed > reportElapsed + POSITION_REPORT_DRIFT_SECONDS) {
    return {
      status: "stale_position",
      reportElapsed,
      positionElapsed,
      reason: `el reporte es reciente pero la posición quedó desactualizada (posición hace ${minutesAgo(positionElapsed)}, reporte hace ${minutesAgo(reportElapsed)})`,
    };
  }

  const ignitionElapsed =
    typeof unit.ultima_ignicion?.hace_segundos === "number" &&
    Number.isFinite(unit.ultima_ignicion.hace_segundos)
      ? unit.ultima_ignicion.hace_segundos
      : null;
  if (
    ignitionElapsed != null &&
    ignitionElapsed < MISSING_REPORT_TICKET_THRESHOLD_SECONDS &&
    positionElapsed > ignitionElapsed + POSITION_REPORT_DRIFT_SECONDS
  ) {
    return {
      status: "stale_position",
      reportElapsed,
      positionElapsed,
      reason: `hay ignición reciente pero la posición no se actualiza (ignición hace ${minutesAgo(ignitionElapsed)}, posición hace ${minutesAgo(positionElapsed)})`,
    };
  }

  return { status: "ok", reportElapsed };
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

function extractLastPlateFromThreadCompat(text: string): string | null {
  const plate = extractLastPlateFromThread(text);
  return plate ? normalizeLoosePlate(plate) : null;
}

/** Pide listado/flota sin patente puntual (no filtrar por patente vieja del hilo). */
function looksLikeUnitListRequest(rawText: string | undefined | null): boolean {
  const t = (rawText ?? "").trim();
  if (!t) return true;
  const norm = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (detectPlate(t)) return false;
  return /\b(listado|lista de unidad|lista de unidades|listame|pasame la lista|p[aá]same la lista|me pasas la lista|dame la lista|ver lista|mis unidades|todas las unidades|todas mis unidades|flota|cuantas unidades|cu[aá]ntas unidades|ver unidades|mis camiones|que unidades|qu[eé] unidades)\b/.test(
    norm
  );
}

/** El cliente habla de otra unidad distinta a la del hilo — no reutilizar patente anterior. */
function looksLikeAnotherUnitRequest(rawText: string | undefined | null): boolean {
  const norm = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(otra unidad|otro unidad|otro veh[ií]culo|otra patente|la otra unidad|segunda unidad|otra camioneta|tengo otra|otro m[oó]vil)\b/.test(
    norm
  );
}

function mentionsMissingReportWithoutPlate(rawText: string | undefined | null): boolean {
  const norm = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (detectPlate(rawText ?? "")) return false;
  return /\b(sin reporte|no reporta|no actualiza|offline|no reporta bien)\b/.test(norm);
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
  issueDetail?: string;
}): Promise<{ ref: string; message: string; reused: boolean }> {
  const plate = normalizeLoosePlate(params.unit.patente || params.unit.unidad || "");
  const issueLabel = params.issueDetail
    ? `problema de reporte (${params.issueDetail})`
    : `sin reporte hace ${params.elapsedText}`;
  const existing = await findRecentMissingReportTicket(params.rawPhone, plate);
  if (!existing?.customer) {
    return {
      ref: "",
      reused: false,
      message: `La unidad ${params.unit.patente || params.unit.unidad} está ${issueLabel}. No pude registrar el caso automáticamente, te derivo con un asesor para revisarlo.`,
    };
  }

  if (existing.ticket) {
    return {
      ref: existing.ticket.code,
      reused: true,
      message: `La unidad ${params.unit.patente || params.unit.unidad} está ${issueLabel}. Ya existe un caso abierto (${existing.ticket.code}) para que Atención al cliente lo revise.`,
    };
  }

  const title = params.issueDetail
    ? `${plate} - ${params.issueDetail}`
    : `${plate} - Unidad sin reporte hace ${params.elapsedText}`;
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
      aiSummary: `Unidad ${plate} con ${issueLabel}. Caso generado automáticamente por Atilio tras validar estado en Wara.`,
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
    message: `La unidad ${params.unit.patente || params.unit.unidad} está ${issueLabel}. Generé el caso N° ${ref} para que Atención al cliente lo revise. Te avisamos por este medio cualquier novedad.`,
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
  const rawText = parsed.data.rawText ?? "";
  const explicitPlate =
    parsed.data.patente ?? parsed.data.plate ?? detectPlate(rawText) ?? "";

  if (looksLikeCompanySelection(rawText.trim()) && !explicitPlate) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        summaryText: "",
        message: "",
        skipResponse_s: "true",
        action: "none" as const,
        unidadesCount: 0,
      },
      { status: BB_STATUS }
    );
  }

  if (
    !explicitPlate &&
    (looksLikeAnotherUnitRequest(rawText) || mentionsMissingReportWithoutPlate(rawText))
  ) {
    const askPlate =
      "¿Cuál es la patente de esa unidad? Pasámela (por ejemplo AI 211 XK) y la consulto en Wara.";
    await appendOutboundBotMessage(rawPhone, askPlate, {
      source: "wara_unidades_ask_plate",
      rawText,
    });
    return NextResponse.json(
      { ok: true, summaryText: askPlate, action: "none" as const, unidadesCount: 0 },
      { status: BB_STATUS }
    );
  }

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
  const scopedThread = threadTextSinceCompanySelection(threadText);
  let result = await consultarEstadoUnidades(session.sessionToken, requestedPlates);
  const useThreadPlate =
    !explicitPlate &&
    !looksLikeUnitListRequest(rawText) &&
    !looksLikeAnotherUnitRequest(rawText) &&
    requestedPlates.length === 0;
  const wantedPlate = normalizeLoosePlate(
    explicitPlate ||
      (useThreadPlate
        ? extractLastPlateFromThreadCompat(scopedThread) ?? detectPlate(scopedThread) ?? ""
        : "")
  );
  const filterUnits = (units: WaraUnidadEstado[], plate: string) =>
    plate
      ? units.filter((u) => {
          const unitPlate = normalizeLoosePlate(u.patente);
          if (!unitPlate) return false;
          return unitPlate === plate || unitPlate.includes(plate) || plate.includes(unitPlate);
        })
      : units;
  let filtered = filterUnits(result.unidades, wantedPlate);
  if (result.ok && wantedPlate && filtered.length === 0 && requestedPlates.length > 0) {
    const full = await consultarEstadoUnidades(session.sessionToken, []);
    if (full.ok && full.unidades.length > 0) {
      result = full;
      filtered = filterUnits(full.unidades, wantedPlate);
    }
  }
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
  const plateDisplay = wantedPlate ? formatPlateWithSpaces(wantedPlate) ?? wantedPlate : "";
  const maintenanceContext = hasPendingMaintenancePlateRequest(threadText);
  let summaryText = !result.ok
    ? result.error || "No pude consultar las unidades en Wara."
    : filtered.length === 0
      ? maintenanceContext && wantedPlate
        ? `Busqué ${plateDisplay} en las unidades de ${session.companyName || result.cliente || "tu empresa"} y no la encontré. Si la unidad es de otra empresa, escribí "cambiar empresa". Si venías programando mantenimiento, mandá la patente con el detalle (por ejemplo: "preventivo ${plateDisplay}").`
        : wantedPlate && !explicitPlate
          ? `No encontré ${plateDisplay} en las unidades de ${session.companyName || result.cliente || "tu empresa"}. ¿Podés confirmarme la patente exacta? Si es de otra empresa, escribí "cambiar empresa".`
          : wantedPlate
            ? `No encontré la patente ${plateDisplay} en las unidades de ${session.companyName || result.cliente || "tu empresa"}. Revisá que esté bien escrita o, si corresponde a otra empresa, escribí "cambiar empresa".`
            : `No encontré una unidad con esa patente para ${session.companyName || result.cliente || "este cliente"}.`
      : filtered.length === 1
        ? summarizeUnit(filtered[0])
        : buildManyUnitsText(filtered);

  if (result.ok && filtered.length === 1 && wantedPlate) {
    const unit = filtered[0];
    const assessment = assessUnitReporting(unit);
    if (assessment) {
      const elapsedText = minutesAgo(assessment.reportElapsed);
      if (assessment.status === "ok") {
        action = "observation";
        summaryText = `La unidad ${unit.patente || unit.unidad} reportó hace ${elapsedText} y la posición también está al día. Como está dentro del margen de observación, no genero ticket por ahora. El GPS puede reportar cada 10 minutos; te recomiendo volver a verificar en aproximadamente una hora.`;
      } else if (assessment.status === "stale_position") {
        action = "ticket";
        const created = await createMissingReportTicket({
          rawPhone,
          unit,
          companyName: session.companyName ?? result.cliente ?? "",
          contactName: session.contactName ?? "",
          elapsedText: minutesAgo(assessment.reportElapsed),
          issueDetail: assessment.reason,
        });
        ticketRef = created.ref;
        summaryText = created.message;
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
