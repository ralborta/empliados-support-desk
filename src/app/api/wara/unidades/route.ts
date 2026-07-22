import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { OPEN_TICKET_THREAD_STATUSES, attachToOpenConversation } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { autoAssignNewTicket } from "@/lib/advisorDistribution";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { detectLoosePlate, detectPlate, extractLastPlateFromThread, formatPlateWithSpaces, hasPendingMaintenancePlateRequest, isPlausibleVehiclePlate, normalizePlate, threadHasActiveOdometerFlow, threadTextSinceCompanySelection } from "@/lib/wara";
import {
  consultarEstadoUnidades,
  looksLikeCompanySelection,
  looksLikeFlowControlCommand,
  looksLikeGreeting,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
  resolveWaraSessionByPhone,
  threadHasRecentLiveUnitConsultIntent,
  type WaraUnidadEstado,
} from "@/lib/waraApi";
import { ensureWaraOdooTicket, pickOdooCompanyName } from "@/lib/waraOdooEscalation";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";
import { assessUnitReporting, formatMinutesAgo, ignitionLabel, telemetryElapsedSeconds } from "@/lib/waraGpsAssessment";
import { buildGpsClientSummary } from "@/lib/waraGpsSummary";
import {
  buildFleetUnitNotFoundMessage,
  filterUnitsByResolvedPlate,
  filterUnitsBySearchTerms,
  looksLikeFleetUnitSearchInput,
  looksLikeUnitListRequest,
  resolveUnitQuery,
} from "@/lib/waraUnitIntent";

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

function minutesAgo(seconds: number | undefined | null): string {
  return formatMinutesAgo(seconds);
}

function hasTelemetrySeconds(value: number | undefined | null): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** Unidad en flota sin telemetría alguna → en backoffice suele figurar equipo "(no instalado)". */
function unitHasNoInstalledEquipment(unit: WaraUnidadEstado): boolean {
  if (hasTelemetrySeconds(unit.ultimo_reporte?.hace_segundos)) return false;
  if (hasTelemetrySeconds(unit.ultima_posicion?.hace_segundos)) return false;
  if (hasTelemetrySeconds(unit.ultima_ignicion?.hace_segundos)) return false;
  if (unit.ultima_ignicion?.estado === true || unit.ultima_ignicion?.estado === false) {
    return false;
  }
  if (
    typeof unit.alimentacion_externa?.voltaje === "number" &&
    Number.isFinite(unit.alimentacion_externa.voltaje)
  ) {
    return false;
  }
  return !!(unit.patente?.trim() || unit.unidad?.trim() || unit.movil_id);
}

function formatUnitLabel(unit: WaraUnidadEstado): string {
  const plateRaw = unit.patente?.trim() || "";
  const plate = plateRaw ? formatPlateWithSpaces(normalizeLoosePlate(plateRaw)) ?? plateRaw : "";
  const nombre = unit.unidad?.trim() || "";
  if (plate && nombre && normalizeLoosePlate(plate) !== normalizeLoosePlate(nombre)) {
    return `${plate} (nombre ${nombre})`;
  }
  return plate || nombre || "la unidad";
}

function summarizeUnit(unit: WaraUnidadEstado): string {
  const ign = unit.ultima_ignicion?.estado === true ? "encendida" : unit.ultima_ignicion?.estado === false ? "apagada" : "sin dato";
  const volt = typeof unit.alimentacion_externa?.voltaje === "number" ? `${unit.alimentacion_externa.voltaje}V` : "sin dato";
  const pos = minutesAgo(unit.ultima_posicion?.hace_segundos);
  return `Unidad ${formatUnitLabel(unit)}: último reporte hace ${minutesAgo(unit.ultimo_reporte?.hace_segundos)}, última posición hace ${pos}, ignición ${ign}, alimentación ${volt}.`;
}

function formatWaraDateLocal(iso: string | undefined | null): string {
  if (!iso?.trim()) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}

function buildUnitTelemetryOdooLines(unit: WaraUnidadEstado): string[] {
  const reportElapsed = telemetryElapsedSeconds(unit.ultimo_reporte?.hace_segundos);
  const positionElapsed = telemetryElapsedSeconds(unit.ultima_posicion?.hace_segundos);
  const ignitionElapsed = telemetryElapsedSeconds(unit.ultima_ignicion?.hace_segundos);
  const lines: string[] = [];
  if (reportElapsed != null) {
    lines.push(
      `Último reporte: hace ${minutesAgo(reportElapsed)}` +
        (unit.ultimo_reporte?.fecha
          ? ` (${formatWaraDateLocal(unit.ultimo_reporte.fecha)} ART)`
          : "")
    );
  }
  if (positionElapsed != null) {
    lines.push(
      `Última posición: hace ${minutesAgo(positionElapsed)}` +
        (unit.ultima_posicion?.fecha
          ? ` (${formatWaraDateLocal(unit.ultima_posicion.fecha)} ART)`
          : "")
    );
  }
  const lat = unit.ultima_posicion?.lat;
  const lon = unit.ultima_posicion?.lon;
  if (typeof lat === "number" && typeof lon === "number") {
    lines.push(`Coordenadas: ${lat}, ${lon}`);
  }
  lines.push(
    `Ignición: ${ignitionLabel(unit)}` +
      (ignitionElapsed != null ? ` — hace ${minutesAgo(ignitionElapsed)}` : "") +
      (unit.ultima_ignicion?.fecha
        ? ` (${formatWaraDateLocal(unit.ultima_ignicion.fecha)} ART)`
        : "")
  );
  const volt = unit.alimentacion_externa?.voltaje;
  if (typeof volt === "number" && Number.isFinite(volt)) {
    lines.push(`Alimentación: ${volt}V`);
  }
  return lines;
}

function looksLikeLocationRequest(text: string | undefined | null): boolean {
  const norm = (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(ubicacion|donde esta|donde quedo|mostrame|mostra|mostrar en el mapa|mapa|coordenadas|localizacion|donde se encuentra|donde anda|en donde|dnde esta)\b/.test(
    norm
  );
}

function formatLocationAppendix(unit: WaraUnidadEstado): string {
  const lat = unit.ultima_posicion?.lat;
  const lon = unit.ultima_posicion?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return "";
  const posAgo = minutesAgo(unit.ultima_posicion?.hace_segundos);
  const fecha = formatWaraDateLocal(unit.ultima_posicion?.fecha);
  const when = fecha ? ` (${fecha})` : "";
  return `\n\nÚltima ubicación conocida hace ${posAgo}${when}: https://www.google.com/maps?q=${lat},${lon}`;
}

function appendLocationIfRequested(summary: string, unit: WaraUnidadEstado, rawText: string): string {
  if (!looksLikeLocationRequest(rawText)) return summary;
  const appendix = formatLocationAppendix(unit);
  return appendix ? `${summary}${appendix}` : summary;
}

function normalizeLoosePlate(value: string): string {
  return normalizePlate(value)?.replace(/\s+/g, "") ?? "";
}

function parseRequestedPlates(body: z.infer<typeof bodySchema>): string[] {
  const explicit = body.patentes ?? [];
  const single = body.patente ?? body.plate ?? detectLoosePlate(body.rawText ?? "") ?? "";
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
  return plate && isPlausibleVehiclePlate(plate) ? normalizeLoosePlate(plate) : null;
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
  if (looksLikeLiveUnitConsultIntent(rawText)) return true;
  return /\b(sin reporte|no reporta|no actualiza|offline|no reporta bien|reportando|reporta bien|esta ok|est[aá] bien|gps|marcando|ignicio|ignicion|senal|señal)\b/.test(
    norm,
  );
}

type UnitQueryRef =
  | { kind: "interno_backoffice"; value: string }
  | { kind: "nombre"; value: string };

function normalizeUnitToken(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/** Interno del backoffice (ej. 003-111): empieza con 0; distinto del nombre M300-111. */
function looksLikeBackofficeInternoCode(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  return /^0\d{2}-\d{3}$/.test(compact);
}

function extractUnitQueryFromText(rawText: string | undefined | null): UnitQueryRef | null {
  const text = (rawText ?? "").trim();
  if (!text) return null;

  const nombreLabel = text.match(/\bnombre\s*(?:de\s+(?:la\s+)?unidad\s*)?(?:es|:|-)?\s*(M?\d{3}-\d{3})/i);
  if (nombreLabel?.[1]) return { kind: "nombre", value: nombreLabel[1] };

  const internoLabel = text.match(/\binterno\s*(?:es|:|-)?\s*([A-Za-z0-9\-]+)/i);
  if (internoLabel?.[1]) {
    const value = internoLabel[1].trim();
    if (looksLikeBackofficeInternoCode(value)) {
      return { kind: "interno_backoffice", value };
    }
    return { kind: "nombre", value };
  }

  const nombreMatch = text.match(/\b(M?\d{3}-\d{3})\b/i);
  if (nombreMatch?.[1]) return { kind: "nombre", value: nombreMatch[1] };

  if (detectPlate(text)) return null;

  return null;
}

function looksLikeInternoMetaQuestion(rawText: string | undefined | null): boolean {
  const norm = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(interno|numero de interno|n[uú]mero de interno)\b/.test(norm) &&
    /\b(no puedo|no podes|puedo pasarte|se puede|pod[eé]s|pasarte)\b/.test(norm)
  );
}

/** Busca por campo API `unidad` (= nombre en backoffice), parcial como el buscador web. */
function filterUnitsByNombre(units: WaraUnidadEstado[], query: string): WaraUnidadEstado[] {
  const norm = normalizeUnitToken(query);
  if (!norm) return [];
  return units.filter((u) => {
    const nombre = normalizeUnitToken(u.unidad || "");
    if (!nombre) return false;
    return nombre === norm || nombre.includes(norm) || norm.includes(nombre);
  });
}

function formatUnitNotFoundMessage(opts: {
  companyName: string;
  wantedPlate?: string;
  unitQuery?: UnitQueryRef | null;
  rawText?: string;
}): string {
  const company = opts.companyName;
  if (opts.wantedPlate) {
    return buildFleetUnitNotFoundMessage({
      companyName: company,
      plate: opts.wantedPlate,
      rawText: opts.rawText,
    });
  }
  if (opts.unitQuery?.kind === "interno_backoffice") {
    return (
      `No encontré el interno ${opts.unitQuery.value} en la API de Wara para ${company}. ` +
      `El código interno del backoffice (ej. 003-111) todavía no viene en la consulta; probá con la matrícula (NKL 952) o el nombre de unidad (M300-111).`
    );
  }
  if (opts.unitQuery?.kind === "nombre") {
    return (
      `No hay ninguna unidad con nombre ${opts.unitQuery.value} en la flota de ${company}. ` +
      `Probá con la matrícula o revisá el nombre en Wara.`
    );
  }
  return buildFleetUnitNotFoundMessage({ companyName: company, rawText: opts.rawText });
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

async function findRecentOpenTicketByPlate(
  rawPhone: string,
  plate: string,
  titleNeedle: string
) {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return null;
  const ticket = await prisma.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
      title: { contains: plate, mode: "insensitive" },
      AND: { title: { contains: titleNeedle, mode: "insensitive" } },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  return { ticket, customer };
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
  return { ticket, customer };
}

async function findRecentNoEquipmentTicket(rawPhone: string, plate: string) {
  const found = await findRecentOpenTicketByPlate(rawPhone, plate, "Sin equipo instalado");
  if (!found) return null;
  return found;
}

async function createMissingReportTicket(params: {
  rawPhone: string;
  unit: WaraUnidadEstado;
  companyName: string;
  contactName: string;
  elapsedText: string;
  issueDetail?: string;
  incidentType?: "MISSING_REPORT" | "GENERAL_TECH";
  ticketTitleSuffix?: string;
}): Promise<{ ref: string; message: string; reused: boolean; odooRef: string | null }> {
  const plate = normalizeLoosePlate(params.unit.patente || params.unit.unidad || "");
  const issueLabel = params.issueDetail
    ? params.issueDetail
    : `sin reporte hace ${params.elapsedText}`;
  const existing = await findRecentMissingReportTicket(params.rawPhone, plate);
  if (!existing?.customer) {
    return {
      ref: "",
      reused: false,
      odooRef: null,
      message: `La unidad ${params.unit.patente || params.unit.unidad} presenta ${issueLabel}. No pude registrar el caso automáticamente, te derivo con un asesor para revisarlo.`,
    };
  }

  if (existing.ticket) {
    return {
      ref: existing.ticket.code,
      reused: true,
      odooRef: null,
      message: `La unidad ${params.unit.patente || params.unit.unidad} presenta ${issueLabel}. Ya existe un caso abierto (${existing.ticket.code}) para que Atención al cliente lo revise.`,
    };
  }

  const title = params.ticketTitleSuffix
    ? `${plate} - ${params.ticketTitleSuffix}`
    : params.issueDetail
      ? `${plate} - ${params.issueDetail}`
      : `${plate} - Unidad sin reporte hace ${params.elapsedText}`;
  const incidentType = params.incidentType ?? "MISSING_REPORT";
  const dedupeKey = `wara_unidades:${plate}:${params.ticketTitleSuffix ?? incidentType}`;

  const { ticket: localTicket, created } = await attachToOpenConversation(prisma, {
    customerId: existing.customer.id,
    contactName:
      params.contactName ||
      existing.customer.name?.trim() ||
      params.companyName ||
      "Sin nombre",
    title,
    messageText: `Reclamo/consulta por unidad: ${plate} — ${issueLabel}`,
    messagePayload: {
      source: "wara_unidades_auto_ticket",
      plate,
      companyName: params.companyName,
      elapsedText: params.elapsedText,
      issueDetail: params.issueDetail ?? "",
      lastReportDate: params.unit.ultimo_reporte?.fecha ?? "",
      phone: params.rawPhone,
    } as Prisma.InputJsonObject,
    incidentType,
    priority: "HIGH",
    status: "IN_PROGRESS",
    aiSummary: `Unidad ${plate}: ${issueLabel}. Caso generado automáticamente por Atilio tras validar estado en Wara.`,
  });

  const odooDescription = [
    `Consulta/reclamo detectado por Atilio / WhatsApp.`,
    `Empresa Wara: ${params.companyName}`,
    `Patente: ${plate}`,
    params.unit.unidad ? `Nombre unidad: ${params.unit.unidad}` : "",
    `Motivo: ${issueLabel}`,
    ...buildUnitTelemetryOdooLines(params.unit),
    `WhatsApp: ${params.rawPhone}`,
    `Ticket local: ${localTicket.code}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { odooRef } = await ensureWaraOdooTicket(prisma, {
    ticketId: localTicket.id,
    dedupeKey,
    subject: title,
    description: odooDescription,
    customerName: params.contactName || existing.customer.name || params.companyName,
    customerPhone: params.rawPhone,
    companyName: params.companyName,
    priority: "HIGH",
    messageSource: "wara_unidades_auto_ticket",
    messagePlate: plate,
    logContext: "Unidades",
  });

  if (odooRef) {
    await prisma.ticket.update({
      where: { id: localTicket.id },
      data: {
        aiSummary: `Unidad ${plate}: ${issueLabel}. Odoo: ${odooRef}.`,
      },
    });
  }

  const ref = odooRef ?? localTicket.code;
  const localReused = !created;

  try {
    await autoAssignNewTicket(localTicket.id);
  } catch (e) {
    console.error("[Unidades] autoAssign:", e);
  }

  const unitLabel = params.unit.patente || params.unit.unidad;
  let message: string;
  if (odooRef) {
    message = `La unidad ${unitLabel} presenta ${issueLabel}. Generé el caso N° ${odooRef} para Atención al cliente.${
      localReused ? ` También quedó en la conversación ${localTicket.code}.` : ""
    } Te avisamos por este medio cualquier novedad.`;
  } else if (localReused) {
    message = `La unidad ${unitLabel} presenta ${issueLabel}. Registré la consulta en el caso abierto (${localTicket.code}) con el mismo asesor.`;
  } else {
    message = `La unidad ${unitLabel} presenta ${issueLabel}. Generé el caso N° ${ref} para que Atención al cliente lo revise. Te avisamos por este medio cualquier novedad.`;
  }

  return {
    ref,
    reused: localReused,
    odooRef,
    message,
  };
}

async function createNoEquipmentTicket(params: {
  rawPhone: string;
  unit: WaraUnidadEstado;
  companyName: string;
  contactName: string;
}): Promise<{ ref: string; message: string; reused: boolean; odooRef: string | null }> {
  const plate = normalizeLoosePlate(params.unit.patente || params.unit.unidad || "");
  const label = formatUnitLabel(params.unit);
  const existing = await findRecentNoEquipmentTicket(params.rawPhone, plate);
  if (!existing?.customer) {
    return {
      ref: "",
      reused: false,
      odooRef: null,
      message: `La unidad ${label} está registrada en Wara pero no tiene equipo GPS instalado, por eso no hay reportes ni posición para mostrar. No pude registrar el caso automáticamente; te derivo con un asesor para revisarlo.`,
    };
  }

  if (existing.ticket) {
    return {
      ref: existing.ticket.code,
      reused: true,
      odooRef: null,
      message: `La unidad ${label} no tiene equipo instalado y no genera telemetría. Ya existe un caso abierto (${existing.ticket.code}) para que Atención al cliente lo revise.`,
    };
  }

  const title = `${plate} - Sin equipo instalado`;
  const dedupeKey = `wara_unidades_no_equipment:${plate}`;

  const { ticket: localTicket, created } = await attachToOpenConversation(prisma, {
    customerId: existing.customer.id,
    contactName:
      params.contactName ||
      existing.customer.name?.trim() ||
      params.companyName ||
      "Sin nombre",
    title,
    messageText: `Consulta por unidad sin equipo instalado: ${label}`,
    messagePayload: {
      source: "wara_unidades_no_equipment",
      plate,
      nombre: params.unit.unidad ?? "",
      movilId: params.unit.movil_id,
      companyName: params.companyName,
      phone: params.rawPhone,
    } as Prisma.InputJsonObject,
    incidentType: "GENERAL_TECH",
    priority: "NORMAL",
    status: "IN_PROGRESS",
    aiSummary: `Unidad ${label} sin equipo GPS instalado (sin telemetría en ConsultarEstadoUnidades). Caso generado por Atilio.`,
  });

  const { odooRef } = await ensureWaraOdooTicket(prisma, {
    ticketId: localTicket.id,
    dedupeKey,
    subject: title,
    description: [
      `Unidad sin equipo GPS instalado detectada por Atilio / WhatsApp.`,
      `Empresa Wara: ${params.companyName}`,
      `Patente: ${params.unit.patente || plate}`,
      params.unit.unidad ? `Nombre (campo unidad en API): ${params.unit.unidad}` : "",
      params.unit.movil_id ? `movil_id: ${params.unit.movil_id}` : "",
      `Motivo: la API no devuelve reporte, posición, ignición ni voltaje.`,
      `WhatsApp: ${params.rawPhone}`,
      `Ticket local: ${localTicket.code}`,
    ]
      .filter(Boolean)
      .join("\n"),
    customerName: params.contactName || existing.customer.name || params.companyName,
    customerPhone: params.rawPhone,
    companyName: params.companyName,
    priority: "NORMAL",
    messageSource: "wara_unidades_no_equipment",
    messagePlate: plate,
    logContext: "Unidades",
  });

  if (odooRef) {
    await prisma.ticket.update({
      where: { id: localTicket.id },
      data: {
        aiSummary: `Unidad ${label} sin equipo instalado. Odoo: ${odooRef}.`,
      },
    });
  }

  const ref = odooRef ?? localTicket.code;
  const localReused = !created;

  try {
    await autoAssignNewTicket(localTicket.id);
  } catch (e) {
    console.error("[Unidades] autoAssign sin equipo:", e);
  }

  let message: string;
  if (odooRef) {
    message = `La unidad ${label} está registrada en Wara pero no tiene equipo GPS instalado, por eso no hay reportes ni posición para mostrar. Generé el caso N° ${odooRef} para Atención al cliente.${
      localReused ? ` También quedó en la conversación ${localTicket.code}.` : ""
    } Te avisamos por este medio cualquier novedad.`;
  } else if (localReused) {
    message = `La unidad ${label} no tiene equipo instalado. Registré la consulta en el caso abierto (${localTicket.code}) con el mismo asesor.`;
  } else {
    message = `La unidad ${label} está registrada en Wara pero no tiene equipo GPS instalado, por eso no hay reportes ni posición para mostrar. Generé el caso N° ${ref} para que Atención al cliente lo revise. Te avisamos por este medio cualquier novedad.`;
  }

  return {
    ref,
    reused: localReused,
    odooRef,
    message,
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
  if (!allowPhoneRequest(rawPhone, 20)) {
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        summaryText: "Recibí muchas consultas seguidas. Esperá un momento e intentá de nuevo.",
      },
      { status: BB_STATUS },
    );
  }
  const threadText = await recentThreadText(rawPhone);
  const rawText = parsed.data.rawText ?? "";
  let explicitPlate =
    parsed.data.patente ?? parsed.data.plate ?? detectLoosePlate(rawText) ?? "";

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

  if (looksLikeFlowControlCommand(rawText.trim())) {
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
    threadHasActiveOdometerFlow(threadText) &&
    looksLikeFleetUnitSearchInput(rawText.trim()) &&
    !looksLikeLiveUnitConsultIntent(rawText) &&
    !looksLikeGpsOrUnitStatusQuestion(rawText)
  ) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        summaryText: "",
        message: "",
        skipResponse_s: "true",
        topicChange_s: "true",
        action: "none" as const,
        unidadesCount: 0,
      },
      { status: BB_STATUS },
    );
  }

  if (
    looksLikeGreeting(rawText.trim()) &&
    !explicitPlate &&
    !extractUnitQueryFromText(rawText) &&
    !parsed.data.patente?.trim() &&
    !parsed.data.plate?.trim()
  ) {
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

  if (looksLikeInternoMetaQuestion(rawText)) {
    const message =
      "Por este chat consulto unidades por matrícula (ej. NKL 952) o por nombre de unidad (ej. M300-111). El código interno del backoffice (ej. 003-111) todavía no viene en la API de Wara; si tenés solo el interno, buscalo en el panel y pasame matrícula o nombre.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_unidades_unit_query_help",
      rawText,
    });
    return NextResponse.json(
      { ok: true, summaryText: message, action: "none" as const, unidadesCount: 0 },
      { status: BB_STATUS }
    );
  }

  const unitQueryInMessage = extractUnitQueryFromText(rawText);
  const scopedThreadEarly = threadTextSinceCompanySelection(threadText);
  const threadPlateEarly =
    extractLastPlateFromThreadCompat(scopedThreadEarly) ?? detectPlate(scopedThreadEarly);

  if (
    !explicitPlate &&
    !unitQueryInMessage &&
    !threadPlateEarly &&
    (looksLikeAnotherUnitRequest(rawText) ||
      mentionsMissingReportWithoutPlate(rawText) ||
      (looksLikeLiveUnitConsultIntent(rawText) && !looksLikeFleetUnitSearchInput(rawText)))
  ) {
    const askPlate = looksLikeLiveUnitConsultIntent(rawText)
      ? "Para revisar el GPS, la ignición o el reporte necesito la unidad: pasame la patente (ej. AD427MC) o la marca/nombre (ej. Nissan)."
      : "¿Cuál es la matrícula o el nombre de la unidad? Pasámela (por ejemplo NKL 952 o M300-111) y la consulto en Wara.";
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
    const waraDetail = session.error?.trim();
    const isOutage =
      session.status >= 500 ||
      (waraDetail && /502|503|504|interrupci|gateway|error de red/i.test(waraDetail));
    const fallbackMsg =
      "No pude consultar las unidades en Wara. Te derivo con un agente para revisarlo.";
    const outageMsg =
      "Wara tiene una interrupción temporal y no pude consultar tus unidades en este momento. " +
      "Las guías de plataforma (Opciones, Unidades) siguen disponibles. Probá de nuevo en unos minutos.";
    return NextResponse.json(
      {
        ok: false,
        error: session.error,
        summaryText: session.requiresCompanySelection
          ? "Antes de consultar unidades necesito que elijas la empresa asociada a este número."
          : isOutage
            ? outageMsg
            : waraDetail
              ? `No pude consultar las unidades en Wara: ${waraDetail}`
              : fallbackMsg,
        requiresCompanySelection: session.requiresCompanySelection ?? false,
        testBlocked: session.testBlocked ?? false,
      },
      { status: BB_STATUS }
    );
  }

  const requestedPlates = parseRequestedPlates(parsed.data);
  const scopedThread = threadTextSinceCompanySelection(threadText);
  let result = await consultarEstadoUnidades(session.sessionToken, requestedPlates);
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (customer) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { waraSessionToken: null, waraSessionAt: null },
      });
    }
    const refreshed = await resolveWaraSessionByPhone(prisma, rawPhone);
    if (refreshed.ok && refreshed.sessionToken) {
      result = await consultarEstadoUnidades(refreshed.sessionToken, requestedPlates);
    }
  }

  let forceListFleet = looksLikeUnitListRequest(rawText);
  let unitQuery = extractUnitQueryFromText(rawText);

  if (
    !forceListFleet &&
    result.ok &&
    result.unidades.length > 0 &&
    requestedPlates.length === 0 &&
    !parsed.data.patente?.trim() &&
    !parsed.data.plate?.trim()
  ) {
    const liveUnitConsult = looksLikeLiveUnitConsultIntent(rawText);
    const resolutionThread = `${scopedThread}\n${rawText}`.trim();
    const recentLiveConsult = threadHasRecentLiveUnitConsultIntent(resolutionThread);
    const preferAiResolution =
      looksLikeFleetUnitSearchInput(rawText) || liveUnitConsult || recentLiveConsult;

    const resolved = await resolveUnitQuery({
      rawText,
      threadText: preferAiResolution ? resolutionThread : scopedThread,
      units: result.unidades,
      preferAi: preferAiResolution,
    });

    if (resolved.intent === "list_fleet") {
      forceListFleet = true;
    } else if (resolved.intent === "need_clarification") {
      const companyName = session.companyName || result.cliente || "tu empresa";
      const clarification =
        resolved.clarificationQuestion ??
        buildFleetUnitNotFoundMessage({ companyName, rawText });
      await appendOutboundBotMessage(rawPhone, clarification, {
        source: "wara_unidades_clarification",
        rawText,
        resolutionSource: resolved.source,
      });
      return NextResponse.json(
        { ok: true, summaryText: clarification, action: "none" as const, unidadesCount: 0 },
        { status: BB_STATUS }
      );
    } else if (resolved.plate) {
      const plateMatches = filterUnitsByResolvedPlate(result.unidades, resolved.plate);
      if (plateMatches.length === 0) {
        const companyName = session.companyName || result.cliente || "tu empresa";
        const notFound = buildFleetUnitNotFoundMessage({
          companyName,
          plate: resolved.plate,
          rawText,
        });
        await appendOutboundBotMessage(rawPhone, notFound, {
          source: "wara_unidades_not_in_fleet",
          rawText,
          plate: resolved.plate,
          resolutionSource: resolved.source,
        });
        return NextResponse.json(
          { ok: true, summaryText: notFound, action: "none" as const, unidadesCount: 0 },
          { status: BB_STATUS }
        );
      }
      explicitPlate = formatPlateWithSpaces(resolved.plate) ?? resolved.plate;
    } else if (!unitQuery && resolved.searchTerms.length > 0) {
      const partialMatches = filterUnitsBySearchTerms(result.unidades, resolved.searchTerms);
      if (partialMatches.length === 1) {
        explicitPlate =
          formatPlateWithSpaces(partialMatches[0].patente || partialMatches[0].unidad || "") ??
          partialMatches[0].patente ??
          "";
      }
    }
  }

  const useThreadPlate =
    !forceListFleet &&
    !explicitPlate &&
    !unitQuery &&
    !looksLikeGreeting(rawText.trim()) &&
    !looksLikeInternoMetaQuestion(rawText) &&
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
    plate ? filterUnitsByResolvedPlate(units, plate) : units;
  let filtered: WaraUnidadEstado[];
  if (result.ok && unitQuery?.kind === "interno_backoffice") {
    filtered = [];
  } else if (result.ok && unitQuery?.kind === "nombre") {
    filtered = filterUnitsByNombre(result.unidades, unitQuery.value);
    if (wantedPlate && filtered.length > 1) {
      filtered = filterUnits(filtered, wantedPlate);
    }
  } else {
    filtered = filterUnits(result.unidades, wantedPlate);
  }
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
      .map((u) => formatUnitLabel(u))
      .filter((label) => label.length > 0);
    const head = labels.slice(0, max).join(", ");
    const remainder = labels.length - max;
    const suffix = remainder > 0 ? ` y ${remainder} más` : "";
    if (unitQuery?.kind === "nombre") {
      return `Encontré ${units.length} unidades con nombre parecido a ${unitQuery.value} en ${cliente}. ${head}${suffix}. Decime la matrícula exacta si querés ver una sola.`;
    }
    return `Tenés ${units.length} unidades en ${cliente}. Algunas: ${head}${suffix}. Decime una matrícula (ej. NKL 952), un nombre (ej. SAVEIRO) o una marca para ver una sola.`;
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
            ? formatUnitNotFoundMessage({
                companyName: session.companyName || result.cliente || "tu empresa",
                wantedPlate,
                rawText,
              })
            : formatUnitNotFoundMessage({
                companyName: session.companyName || result.cliente || "tu empresa",
                unitQuery,
                rawText,
              })
      : filtered.length === 1 && !forceListFleet
        ? summarizeUnit(filtered[0])
        : unitQuery || wantedPlate
          ? buildManyUnitsText(filtered)
          : buildManyUnitsText(result.unidades);

  const isSingleUnitQuery =
    !forceListFleet &&
    (!!wantedPlate || !!unitQuery || requestedPlates.length > 0 || !!explicitPlate);

  if (result.ok && filtered.length === 1 && isSingleUnitQuery) {
    const unit = filtered[0];
    if (unitHasNoInstalledEquipment(unit)) {
      action = "ticket";
      const created = await createNoEquipmentTicket({
        rawPhone,
        unit,
        companyName: pickOdooCompanyName(session.companyName, result.cliente),
        contactName: session.contactName ?? "",
      });
      ticketRef = created.ref;
      summaryText = created.message;
    } else {
      const assessment = assessUnitReporting(unit);
      if (assessment) {
        const elapsedText = minutesAgo(assessment.reportElapsed);
        const label = formatUnitLabel(unit);
        let ticketIssueDetail: string | undefined;
        if (assessment.status === "ok" || assessment.status === "coherent_pause") {
          action = "observation";
          summaryText = await buildGpsClientSummary({
            unitLabel: label,
            unit,
            assessment,
            action,
          });
        } else if (assessment.status === "ignition_failure") {
          action = "ticket";
          const ignText =
            assessment.ignitionElapsed != null
              ? `hace ${minutesAgo(assessment.ignitionElapsed)}`
              : "sin dato reciente";
          ticketIssueDetail = `falla de ignición: reporte y posición al día pero la ignición no acompaña (última ignición ${ignText}, ${ignitionLabel(unit)})`;
          const created = await createMissingReportTicket({
            rawPhone,
            unit,
            companyName: pickOdooCompanyName(session.companyName, result.cliente),
            contactName: session.contactName ?? "",
            elapsedText,
            issueDetail: ticketIssueDetail,
            incidentType: "GENERAL_TECH",
            ticketTitleSuffix: "Falla de ignición",
          });
          ticketRef = created.ref;
          summaryText = await buildGpsClientSummary({
            unitLabel: label,
            unit,
            assessment,
            action,
            ticketRef: created.ref,
            odooRef: created.odooRef ?? undefined,
            ticketReused: created.reused,
            ticketIssueDetail,
          });
        } else if (assessment.status === "stale_position") {
          action = "ticket";
          ticketIssueDetail = assessment.reason;
          const created = await createMissingReportTicket({
            rawPhone,
            unit,
            companyName: pickOdooCompanyName(session.companyName, result.cliente),
            contactName: session.contactName ?? "",
            elapsedText: minutesAgo(assessment.reportElapsed),
            issueDetail: ticketIssueDetail,
            incidentType: "GENERAL_TECH",
            ticketTitleSuffix: "Pérdida de señal satelital",
          });
          ticketRef = created.ref;
          summaryText = await buildGpsClientSummary({
            unitLabel: label,
            unit,
            assessment,
            action,
            ticketRef: created.ref,
            odooRef: created.odooRef ?? undefined,
            ticketReused: created.reused,
            ticketIssueDetail,
          });
        } else {
          action = "ticket";
          ticketIssueDetail = `falta de reporte: el GPS no envía datos hace ${elapsedText}`;
          const created = await createMissingReportTicket({
            rawPhone,
            unit,
            companyName: pickOdooCompanyName(session.companyName, result.cliente),
            contactName: session.contactName ?? "",
            elapsedText,
            issueDetail: ticketIssueDetail,
            ticketTitleSuffix: "Falta de reporte",
          });
          ticketRef = created.ref;
          summaryText = await buildGpsClientSummary({
            unitLabel: label,
            unit,
            assessment,
            action,
            ticketRef: created.ref,
            odooRef: created.odooRef ?? undefined,
            ticketReused: created.reused,
            ticketIssueDetail,
          });
        }
      }
    }
    summaryText = appendLocationIfRequested(summaryText, unit, rawText);
  }

  if (!summaryText.trim() && looksLikeFleetUnitSearchInput(rawText)) {
    summaryText = buildFleetUnitNotFoundMessage({
      companyName: session.companyName || result.cliente || "tu empresa",
      rawText,
      plate: wantedPlate || undefined,
    });
  }

  await appendOutboundBotMessage(rawPhone, summaryText, {
    source: "wara_unidades_response",
    ok: result.ok,
    unidadesCount: filtered.length,
    companyName: pickOdooCompanyName(session.companyName, result.cliente),
    action,
    ticketRef,
  });

  return NextResponse.json(
    {
      ...result,
      unidades: filtered,
      companyName: pickOdooCompanyName(session.companyName, result.cliente),
      contactName: session.contactName ?? "",
      unidadesCount: filtered.length,
      summaryText,
      message: summaryText,
      action,
      ticketRef,
    },
    { status: BB_STATUS }
  );
}
