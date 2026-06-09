import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { registrarCambioOdometroHorometro, resolveWaraSessionByPhone } from "@/lib/waraApi";
import { detectPlate, formatPlateWithSpaces, normalizePlate } from "@/lib/wara";

const numericValue = z.union([z.number(), z.string()]).transform((value) => {
  const n = typeof value === "number" ? value : Number(value.replace(",", ".").trim());
  return Number.isFinite(n) ? n : Number.NaN;
});

const bodySchema = z
  .object({
    phone: z.string().min(8).optional(),
    from: z.string().min(8).optional(),
    patente: z.string().min(2).optional(),
    plate: z.string().min(2).optional(),
    fecha: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    odometro: numericValue.optional(),
    odometer: numericValue.optional(),
    horometro: numericValue.optional(),
    hourmeter: numericValue.optional(),
    rawText: z.string().optional(),
    confirm: z.string().optional(),
    confirmation: z.string().optional(),
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

function fechaWara(value: string | undefined, timezone?: string): string {
  const target = value?.trim() ? new Date(value) : new Date();
  if (Number.isNaN(target.getTime())) return "";
  const tz = timezone?.trim() || "America/Argentina/Buenos_Aires";
  try {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(target);
    const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}`;
  } catch {
    return target.toISOString().slice(0, 19);
  }
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseFromText(rawText: string): {
  patente?: string;
  odometro?: number;
  horometro?: number;
} {
  const text = rawText || "";
  const patente = detectPlate(text) ?? undefined;
  const cleaned = patente
    ? text.replace(new RegExp(patente.replace(/(.)/g, "$1\\s?"), "gi"), " ")
    : text;
  const kmCandidates: string[] = [];
  const horoCandidates: string[] = [];
  const kmRegex = /(?:od[oó]metro|kilometraje|kil[oó]metros?|km)[^\d]{0,20}(\d[\d.\s,]*\d|\d)/gi;
  const kmTrailRegex = /(\d[\d.\s,]*\d|\d)\s*(?:km|kil[oó]metros?)\b/gi;
  const horoRegex = /(?:hor[oó]metro|horas?)[^\d]{0,20}(\d[\d.\s,]*\d|\d)/gi;
  const horoTrailRegex = /(\d[\d.\s,]*\d|\d)\s*(?:hs|h|horas?)\b/gi;
  for (const m of cleaned.matchAll(kmRegex)) if (m[1]) kmCandidates.push(m[1]);
  for (const m of cleaned.matchAll(kmTrailRegex)) if (m[1]) kmCandidates.push(m[1]);
  for (const m of cleaned.matchAll(horoRegex)) if (m[1]) horoCandidates.push(m[1]);
  for (const m of cleaned.matchAll(horoTrailRegex)) if (m[1]) horoCandidates.push(m[1]);
  const pickLargest = (values: string[]): number | undefined => {
    let best: number | undefined;
    for (const v of values) {
      const n = parseNumber(v.replace(/\s+/g, ""));
      if (typeof n === "number" && (best === undefined || n > best)) best = n;
    }
    return best;
  };
  return {
    patente,
    odometro: pickLargest(kmCandidates),
    horometro: pickLargest(horoCandidates),
  };
}

function isConfirmed(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return /^confirmo$/i.test(value.trim());
}

/** Primer número finito de una lista (los datos del body vienen como number|NaN). */
function firstFiniteNumber(...vals: Array<number | undefined>): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Reconstruye el texto de la conversación reciente desde la base.
 * BuilderBot manda {history} multilínea que rompe el JSON del body; en vez de eso,
 * leemos lo que ya quedó persistido (mensajes del cliente y del bot) para parsear
 * patente / odómetro / fecha del resumen "Voy a registrar:".
 */
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
      take: 24,
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

/** Extrae una fecha (dd/mm/aa[aa], opcional hh:mm) del texto; toma la última mencionada. */
function parseFechaFromText(text: string): string | undefined {
  const matches = [
    ...(text || "").matchAll(
      /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\sT,]+(\d{1,2}):(\d{2}))?/g
    ),
  ];
  if (matches.length === 0) return undefined;
  const m = matches[matches.length - 1];
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const hh = (m[4] ?? "00").padStart(2, "0");
  const min = (m[5] ?? "00").padStart(2, "0");
  return `${year}-${mm}-${dd}T${hh}:${min}:00`;
}

function formatSuccessMessage(result: Awaited<ReturnType<typeof registrarCambioOdometroHorometro>>, patente: string): string {
  if (!result.ok) return result.error || "No pude registrar el cambio en Wara.";
  const parts = [`Listo, registré el cambio para la unidad ${patente}.`];
  if (result.odometro?.valor_nuevo_km != null) {
    parts.push(`Odómetro nuevo: ${result.odometro.valor_nuevo_km} km.`);
  }
  if (result.horometro?.valor_nuevo_horas != null) {
    parts.push(`Horómetro nuevo: ${result.horometro.valor_nuevo_horas} h.`);
  }
  return parts.join(" ");
}

// BuilderBot Cloud solo mapea el body de la respuesta (p.ej. {message_s}) cuando el
// status HTTP es 2xx. Como estos endpoints los consume exclusivamente BuilderBot,
// SIEMPRE respondemos 200 y dejamos el estado real en `ok` + el texto en `message`.
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
      { ok: false, error: "BUILDERBOT_CONTEXT_API_KEY/PULZE_API_KEY no configurado", message: "No pude autenticar la solicitud interna." },
      { status: BB_STATUS }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Body inválido", message: "Para registrar el cambio necesito la patente y el nuevo valor de odómetro (en km) o de horómetro (en horas). ¿Me los pasás?", details: parsed.error.flatten() }, { status: BB_STATUS });
  }

  if (!validateContextSecret(keyFromRequest(req, parsed.data))) {
    return NextResponse.json({ ok: false, error: "API key inválida o faltante", message: "No pude autenticar la solicitud interna." }, { status: BB_STATUS });
  }

  const rawPhone = (parsed.data.phone ?? parsed.data.from ?? "").trim();
  const fromText = parseFromText(parsed.data.rawText ?? "");
  // No dependemos de {history} (rompe el JSON): reconstruimos el trámite desde la base.
  const threadText = await recentThreadText(rawPhone);
  const threadParsed = parseFromText(threadText);
  const patente = normalizePlate(
    parsed.data.patente ?? parsed.data.plate ?? fromText.patente ?? threadParsed.patente ?? ""
  );
  const odometro = firstFiniteNumber(
    parsed.data.odometro,
    parsed.data.odometer,
    fromText.odometro,
    threadParsed.odometro
  );
  const horometro = firstFiniteNumber(
    parsed.data.horometro,
    parsed.data.hourmeter,
    fromText.horometro,
    threadParsed.horometro
  );
  const confirmation = parsed.data.confirm ?? parsed.data.confirmation;

  if (!patente) {
    return NextResponse.json({ ok: false, error: "Patente inválida", message: "¿Me pasás la patente de la unidad? Por ejemplo AA123BB." }, { status: BB_STATUS });
  }
  if (!(typeof odometro === "number" && Number.isFinite(odometro)) && !(typeof horometro === "number" && Number.isFinite(horometro))) {
    return NextResponse.json({ ok: false, error: "Falta odómetro u horómetro", message: "¿Cuál es el nuevo valor de odómetro (en km) o de horómetro (en horas)?" }, { status: BB_STATUS });
  }
  if (!isConfirmed(confirmation)) {
    return NextResponse.json({
      ok: false,
      confirmationRequired: true,
      error: "Falta confirmación",
      message: `Antes de registrar en Wara, confirmá si querés aplicar este cambio: patente ${patente}${typeof odometro === "number" ? `, odómetro ${odometro} km` : ""}${typeof horometro === "number" ? `, horómetro ${horometro} h` : ""}. Respondé CONFIRMO para continuar.`,
      patente,
      odometro,
      horometro,
    }, { status: BB_STATUS });
  }

  const session = await resolveWaraSessionByPhone(prisma, rawPhone);
  if (!session.ok || !session.sessionToken) {
    return NextResponse.json(
      {
        ok: false,
        error: session.error,
        message: session.requiresCompanySelection
          ? "Antes de registrar el cambio necesito que elijas la empresa asociada a este número."
          : "No pude validar la sesión con Wara para registrar el cambio. Te derivo con un agente.",
        requiresCompanySelection: session.requiresCompanySelection ?? false,
        testBlocked: session.testBlocked ?? false,
      },
      { status: BB_STATUS }
    );
  }

  const customerTz =
    session.lookup?.customerTimezone || session.lookup?.userTimezone || "America/Argentina/Buenos_Aires";
  const fecha = fechaWara(
    parsed.data.fecha ?? parsed.data.date ?? parseFechaFromText(threadText),
    customerTz
  );
  if (!fecha) {
    return NextResponse.json(
      { ok: false, error: "Fecha inválida", message: "La fecha indicada no es válida." },
      { status: BB_STATUS }
    );
  }

  const patenteParaWara = formatPlateWithSpaces(patente) ?? patente;
  const result = await registrarCambioOdometroHorometro(session.sessionToken, {
    patente: patenteParaWara,
    fecha,
    ...(typeof odometro === "number" && Number.isFinite(odometro) ? { odometro } : {}),
    ...(typeof horometro === "number" && Number.isFinite(horometro) ? { horometro } : {}),
  });

  const responseMessage = formatSuccessMessage(result, patente);
  await appendOutboundBotMessage(rawPhone, responseMessage, {
    source: "wara_odometro_response",
    ok: result.ok,
    patente,
    companyName: session.companyName ?? "",
  });

  return NextResponse.json(
    {
      ...result,
      patente,
      fecha,
      companyName: session.companyName ?? "",
      contactName: session.contactName ?? "",
      message: responseMessage,
    },
    { status: BB_STATUS }
  );
}
