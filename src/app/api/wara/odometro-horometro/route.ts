import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { statusAfterOutboundMessage } from "@/lib/ticketStatusAfterMessage";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import {
  isCustomerContextAuthConfigured,
  validateContextSecret,
} from "@/lib/builderbotCustomerContext";
import { registrarCambioOdometroHorometro, resolveWaraSessionByPhone, validatePlateInFleetForPhone, findFleetUnitByPlate } from "@/lib/waraApi";
import {
  detectLoosePlate,
  detectPlate,
  extractLastPlateFromThread,
  extractPlateCorrectionHint,
  extractPlateFromOdometerSummary,
  extractPlateFromPerfectoTomo,
  extractOdometroFromOdometerSummary,
  extractOdometroFromOdometerContext,
  extractHorometroFromOdometerSummary,
  formatPlateWithSpaces,
  resolveOdometerContextPlate,
  hasPendingOdometerConfirmation,
  isExamplePlate,
  isPlausibleVehiclePlate,
  looksLikeBareNumericUnitId,
  isOdometerFlowSuperseded,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerFlowReminder,
  looksLikeOdometerHelpRequest,
  looksLikeOdometerIntentStart,
  looksLikeBareOdometerTopicMention,
  looksLikeOdometerPendingDataAmendment,
  looksLikeGenericCorrectionIntent,
  looksLikeBriefConfirmation,
  looksLikePendingTramiteAffirmation,
  threadAwaitingOdometerConfirmDetails,
  looksLikeHorometerOnlyIntent,
  looksLikeFreshOdometerRestartRequest,
  looksLikeUnitRejection,
  normalizePlate,
  resolveWaraPatenteForApi,
  threadHasActiveOdometerFlow,
  threadAwaitingHorometerPlate,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerPlate,
  threadAwaitingOdometerKmValue,
  threadTextSinceCompanySelection,
  extractPlatePrefixFromMessage,
  lastTomoMeterKindInThreadTail,
  stripMeterValuesMatchingUnitReference,
} from "@/lib/wara";
import {
  extractExplicitUnitNameFromText,
  looksLikeFleetUnitSearchInput,
  looksLikeUnitNameInMessage,
  looksLikeVagueUnitReference,
  resolvePlateWithWaraFleet,
  shouldClearOdometerPlateFromThread,
} from "@/lib/waraUnitIntent";
import { fechaWara, formatFechaDisplay, isFechaEnFuturo, parseFechaFromText, looksLikeAhoraComoFechaLectura, fechaLecturaTieneHora, mergeFechaConHoraSuelt, stripBotPromptExamples, stripBotOdometerBotSpeech, fechaLocalNaiveToWaraUtc } from "@/lib/odometroFecha";
import { resolveOdometerHorometerFields, looksLikeClockTimeOnlyReading, stripHorometroConfusedWithClockTime } from "@/lib/odometroHorometroExtract";
import { clearPendingAction, getPendingAction, setPendingAction } from "@/lib/pendingAction";
import { humanizeBotReply } from "@/lib/botReplyHumanizer";
import {
  formatAskUnit,
  formatFleetUnitLabel,
  formatMeterAsk,
  formatMeterAskWithReading,
  formatMeterConfirm,
  splitFechaDisplayParts,
} from "@/lib/waraWhatsAppFormat";
import { composeOdometerDialogueReply } from "@/lib/odometerDialogueAI";
import { getActiveUnit, setActiveUnit, shouldUseActiveUnitFallback } from "@/lib/activeUnit";
import {
  clearSessionNotebook,
  getSessionNotebook,
  isConversationNotebookEnabled,
  notebookIndicatesHorometerFlow,
  patchSessionNotebook,
  resolveContextUnitPlate,
  resolveMeterNotebookType,
} from "@/lib/conversationNotebook";
import {
  looksLikeBareAtilioMention,
  looksLikeConversationAcknowledgement,
  looksLikeGreeting,
  looksLikeNonOdometerOperationalIntent,
  looksLikeOpcionesInfoRequest,
  looksLikePlateCorrectionRequest,
  looksLikeUnidadesInfoRequest,
  looksLikeOdometerConfirmationRejection,
  looksLikeVehicleBrandOrUnitSearch,
  shouldContinueOdometerFlow,
  clientSupersedesOdometerConfirmation,
} from "@/lib/waraApi";

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
    body: z.string().optional(),
    message: z.string().optional(),
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


function isPlausibleOdometerReading(
  value: number | undefined,
  rawText: string,
  opts: { pendingConfirm: boolean; explicitKmInMessage: boolean; awaitingKmValue: boolean },
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (opts.pendingConfirm || opts.explicitKmInMessage || opts.awaitingKmValue) return true;
  // Bug 2026-07-27: "OST 223" en el hilo filtraba 223 como km (dígitos de patente).
  if (value < 1000) return false;
  return true;
}

function messageExplicitlyStatesKm(rawText: string): boolean {
  return (
    /\b(km|kil[oó]metros?|kilometraje|od[oó]metro)\b/i.test(rawText) &&
    /\d/.test(rawText)
  );
}

/** "97880" tras "¿Cuál es el nuevo odómetro en km?" — sin palabra km. */
function parseBareOdometerKm(rawText: string): number | undefined {
  const t = rawText.trim().replace(/\./g, "").replace(/\s+/g, "");
  if (!/^\d{4,7}$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseBareHorometerHours(rawText: string): number | undefined {
  const trimmed = rawText.trim();
  const withUnit = trimmed.match(/^(\d{1,7})\s*(?:hs?|hrs?|horas?|hr)\b/i);
  if (withUnit) {
    const n = Number(withUnit[1]);
    return Number.isFinite(n) ? n : undefined;
  }
  const t = trimmed.replace(/\./g, "").replace(/\s+/g, "");
  if (!/^\d{1,7}$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Bug real, producción 2026-07-29: con la confirmación YA mostrada ("Voy a registrar: ...
 * Odómetro: 133567 km ... respondé CONFIRMO"), si el cliente contesta directamente con el
 * valor corregido sin repetir "odómetro"/"horómetro" (ej. "186550"), no había NINGÚN
 * disparador que lo reconociera como corrección — el bot repetía el recordatorio genérico
 * de CONFIRMO ignorando el número, y el dato corregido se perdía por completo. Mientras hay
 * una confirmación pendiente, un número suelto (con o sin "km"/"hs" al lado) SIEMPRE es el
 * valor corregido: no hay ningún otro dato que el bot esté esperando en ese momento.
 */
function parseBareNumericPendingAmendment(rawText: string): number | undefined {
  const t = rawText
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");
  const m = t.match(/^(\d{1,8}(?:\.\d{1,2})?)\s*(?:km\.?|kms?\.?|hs?\.?|horas?)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** "me equivoqué es 17", "perdón es 186550 km" durante confirmación pendiente. */
function parseInlineNumericCorrection(rawText: string): number | undefined {
  const t = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const m = t.match(
    /\b(?:es|era|son|eran|fue|fueron)\s+(\d{1,8}(?:[.,]\d{1,2})?)\s*(?:km\.?|kms?\.?|hs?\.?|horas?)?\b/,
  );
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
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
  // Bug 2026-08-07: no parsear "ej. 10500 km" ni "Tomé … (10500 km)" del bot.
  const text = stripBotOdometerBotSpeech(rawText || "");
  const patente = detectPlate(text) ?? undefined;
  const cleaned = patente
    ? text.replace(new RegExp(patente.replace(/(.)/g, "$1\\s?"), "gi"), " ")
    : text;
  const kmCandidates: string[] = [];
  const horoCandidates: string[] = [];
  // Sin \s en el run de dígitos: bug real 2026-08-05 — "05/08/26\n99000 km" capturaba
  // "26\n99000" → 2699000 (año corto de la fecha pegado al km). Miles con punto/coma OK.
  const kmRegex = /(?:od[oó]metro|kilometraje|kil[oó]metros?|km)[^\d]{0,20}(\d[\d.,]*\d|\d)/gi;
  const kmTrailRegex = /(\d[\d.,]*\d|\d)\s*(?:km|kil[oó]metros?)\b/gi;
  // "Hora: 09:30" (hora de lectura) NO es horómetro; solo horómetro explícito o "horas" en plural.
  const horoRegex = /(?:hor[oó]metro|\bhoras\b)[^\d]{0,20}(\d[\d.,]*\d|\d)/gi;
  const horoTrailRegex = /(\d[\d.,]*\d|\d)\s*(?:hs|\bhoras\b)\b/gi;
  for (const m of cleaned.matchAll(kmRegex)) if (m[1]) kmCandidates.push(m[1]);
  for (const m of cleaned.matchAll(kmTrailRegex)) if (m[1]) kmCandidates.push(m[1]);
  for (const m of cleaned.matchAll(horoRegex)) if (m[1]) horoCandidates.push(m[1]);
  for (const m of cleaned.matchAll(horoTrailRegex)) if (m[1]) horoCandidates.push(m[1]);
  // Último candidato (el más reciente en el texto), NO el mayor: si el hilo aún
  // arrastraba 10500 del bot y el cliente dijo 8900, pickLargest elegía 10500
  // (bug producción 2026-08-07).
  const pickLast = (values: string[]): number | undefined => {
    for (let i = values.length - 1; i >= 0; i--) {
      const n = parseNumber(values[i].replace(/\s+/g, ""));
      if (typeof n === "number") return n;
    }
    return undefined;
  };
  return {
    patente,
    odometro: pickLast(kmCandidates),
    horometro: pickLast(horoCandidates),
  };
}

/**
 * De los prompts EXACTOS que el propio bot manda pidiendo el valor/patente de odómetro u
 * horómetro, ¿cuál aparece más tarde (más reciente) en el tail del hilo? Ver uso y bug
 * real, producción 2026-07-29, en horometerFlowActive más abajo — desempata cuando ambas
 * preguntas (una vieja, una nueva tras una corrección) conviven en el mismo tail.
 */
function lastAwaitingFieldPromptInTail(threadText: string): "odometro" | "horometro" | null {
  const tail = threadText
    .slice(-2500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const horoIdx = Math.max(
    tail.lastIndexOf("para registrar el cambio de horometro necesito la patente"),
    tail.lastIndexOf("cual es el nuevo horometro en horas"),
    tail.lastIndexOf("cuantas horas de motor"),
  );
  const odoIdx = Math.max(
    tail.lastIndexOf("para registrar el cambio de odometro necesito la patente"),
    tail.lastIndexOf("cual es el nuevo odometro en km"),
    tail.lastIndexOf("cual es el nuevo valor de odometro"),
  );
  if (horoIdx < 0 && odoIdx < 0) return null;
  return horoIdx > odoIdx ? "horometro" : "odometro";
}

/** True si el hilo pide explícitamente actualizar horómetro (no confundir con "hora de lectura"). */
function mentionsHorometroIntent(text: string): boolean {
  const t = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\bhorometro\b/.test(t) ||
    /\bhoras de motor\b/.test(t) ||
    /\bcambio de horometro\b/.test(t) ||
    /\bactualizar horometro\b/.test(t)
  );
}

function resolveHorometroForWara(opts: {
  explicitHorometro?: number;
  parsedHorometro?: number;
  combinedText: string;
}): number | undefined {
  if (typeof opts.explicitHorometro === "number" && Number.isFinite(opts.explicitHorometro)) {
    return opts.explicitHorometro;
  }
  if (typeof opts.parsedHorometro !== "number" || !Number.isFinite(opts.parsedHorometro)) {
    return undefined;
  }
  if (!mentionsHorometroIntent(opts.combinedText)) {
    return undefined;
  }
  return opts.parsedHorometro;
}

/**
 * Confirmación tolerante: acepta CONFIRMO en cualquier capitalización, con acentos,
 * espacios o puntuación de más (ej. "Confirm,o", "confirmo!"), y también un "sí" claro
 * (sí, dale, ok, listo, correcto, etc.). No exige mayúsculas ni la palabra exacta.
 */
function isConfirmed(value: string | undefined): boolean {
  if (looksLikeBriefConfirmation(value)) return true;
  if (looksLikePendingTramiteAffirmation(value)) return true;
  if (looksLikeConversationAcknowledgement(value)) return false;
  if (!value?.trim()) return false;
  const t = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (!t) return false;
  if (t.startsWith("conf")) return true;
  const accepted = new Set([
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
  ]);
  return accepted.has(t);
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
    return threadTextSinceCompanySelection(
      msgs
        .reverse()
        .map((m) => m.text)
        .filter(Boolean)
        .join("\n"),
    );
  } catch {
    return "";
  }
}


function formatSuccessMessage(
  result: Awaited<ReturnType<typeof registrarCambioOdometroHorometro>>,
  patente: string,
  fechaDisplay?: string | null,
): string {
  if (!result.ok) return result.error || "No pude registrar el cambio en Wara.";
  const parts = [`Listo, registré el cambio para la unidad ${patente}.`];
  if (result.odometro?.valor_nuevo_km != null) {
    parts.push(`Odómetro nuevo: ${result.odometro.valor_nuevo_km} km.`);
  }
  if (result.horometro?.valor_nuevo_horas != null) {
    parts.push(`Horómetro nuevo: ${result.horometro.valor_nuevo_horas} h.`);
  }
  // Confirmar la fecha/hora registrada evita el "¿se guardó como te la pedí?" a
  // ciegas: bug real, producción 2026-07-23 (ver fechaWara/parseFechaFromText).
  if (fechaDisplay) {
    parts.push(`Fecha registrada: ${fechaDisplay}.`);
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
    data: { lastMessageAt: new Date(), status: statusAfterOutboundMessage(targetTicket.status) },
  });
}

/** Resuelve patente contra flota (marca, prefijo, nombre, patente parcial) antes de pedir km/hs o confirmar. */
async function resolvePatenteFromFleetForMeterTramite(params: {
  rawPhone: string;
  rawText: string;
  flowThreadText: string;
  explicitUnitNameInMessage?: string | null;
}): Promise<
  | { kind: "resolved"; patente: string }
  | { kind: "clarification"; response: NextResponse }
  | { kind: "not_found" }
> {
  const hintText = [params.rawText, params.flowThreadText].filter(Boolean).join("\n");
  const fleetPlate = await resolvePlateWithWaraFleet(
    prisma,
    params.rawPhone,
    hintText,
    params.flowThreadText,
    null,
    {
      preferAi: !params.explicitUnitNameInMessage,
      odometerContext: true,
    },
  );
  if (fleetPlate.ok) {
    const patente = normalizePlate(fleetPlate.plate);
    if (patente) return { kind: "resolved", patente };
  }
  if (!fleetPlate.ok && fleetPlate.reason === "clarification") {
    await appendOutboundBotMessage(params.rawPhone, fleetPlate.message, {
      source: "wara_odometro_response",
      stage: "unit_clarification",
    });
    return {
      kind: "clarification",
      response: NextResponse.json(
        {
          ok: false,
          ok_s: "false",
          error: "Varias unidades",
          message: fleetPlate.message,
        },
        { status: BB_STATUS },
      ),
    };
  }
  return { kind: "not_found" };
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
  const rawText = (
    parsed.data.rawText ??
    parsed.data.body ??
    parsed.data.message ??
    ""
  ).trim();
  const odometerIntentStart = looksLikeOdometerIntentStart(rawText);
  const odometerHelpStart = looksLikeOdometerHelpRequest(rawText);
  const horometerOnlyIntent = looksLikeHorometerOnlyIntent(rawText);
  const odometerFlowStart = odometerIntentStart || odometerHelpStart;
  const bareOdometerTopic = looksLikeBareOdometerTopicMention(rawText);

  // Solo dijo "odómetro" / "ODOMETRO" sin verbo: preguntar qué quiere hacer
  // (bug 2026-08-07: se ignoraba o se pedía síntoma GPS).
  if (bareOdometerTopic) {
    const preliminaryForClarify = await recentThreadText(rawPhone);
    const unitHint =
      formatPlateWithSpaces(extractLastPlateFromThread(preliminaryForClarify) ?? "") ||
      extractLastPlateFromThread(preliminaryForClarify);
    const fallbackTemplate = unitHint
      ? `Sobre ${unitHint}: ¿qué necesitás con el odómetro? ¿Corregir o actualizar el kilometraje, o es otra consulta?`
      : `¿Qué necesitás con el odómetro: corregir o actualizar el kilometraje, o es otra consulta?`;
    const message = await composeOdometerDialogueReply({
      situation: "clarify_odometer_intent",
      history: preliminaryForClarify,
      lastCustomerMessage: rawText,
      fieldHint: "odometro",
      fallbackTemplate,
    });
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: "clarify_odometer_intent",
    });
    return NextResponse.json(
      { ok: true, ok_s: "true", flowComplete_s: "true", message },
      { status: BB_STATUS },
    );
  }

  // Bug real, producción 2026-07-23: "hagamos un cambio de odómetro de ESA unidad"
  // (arranque de trámite CON referencia explícita a una unidad ya resuelta antes, ej.
  // por una consulta de GPS/reporte previa) perdía esa referencia por completo: al ser
  // "odometerFlowStart", el hilo se vaciaba a "" y ni siquiera se llegaba a mirar la
  // "unidad activa" (Customer.activeUnit) antes de pedir la patente de cero — como si
  // el cliente no hubiese dicho "esa unidad" en absoluto. Un arranque de trámite con
  // referencia vaga explícita NO debe tratarse igual que uno realmente "en blanco"
  // ("quiero cambiar el odómetro" sin ninguna pista de unidad).
  const explicitVagueUnitReference = looksLikeVagueUnitReference(rawText);
  // Bug real, producción 2026-07-23: "Aun no te dije la hora o el dia del cambio de
  // odometro" contiene "cambio de odometro" → looksLikeOdometerIntentStart lo
  // clasifica como arranque de trámite, pero el cliente en realidad está AMPLIANDO
  // una confirmación YA PENDIENTE (patente + km recién propuestos, esperando
  // CONFIRMO). Sin mirar esto ANTES de decidir si el arranque es "en blanco", el
  // hilo se vaciaba a "" y esa patente/km ya propuestos se perdían por completo — el
  // bot terminaba pidiendo la patente de cero, como si el cliente no hubiese dicho
  // nada todavía.
  const preliminaryThreadText = await recentThreadText(rawPhone);
  // Pedido explícito, 2026-07-29: que el trámite se "reinicie solo" con el tiempo, en vez
  // de depender únicamente de detectar frases de cierre/cambio de tema en el hilo (que
  // siempre pueden quedar cortas ante una frase nueva no prevista, como pasó hoy).
  // getPendingAction ya tiene un TTL de 45 minutos (pendingAction.ts) — se usa acá como
  // gate adicional: si ya no hay un pendingAction vigente de tipo "odometro" en la base
  // (venció o nunca se guardó), no importa qué diga el texto viejo del hilo: NO se trata
  // como confirmación pendiente real. Esto expira automáticamente cualquier trámite
  // abandonado, sin arriesgar los casos donde sí sigue vigente y reciente.
  const dbPendingOdoAction = await getPendingAction(prisma, rawPhone);
  const hasLiveOdometerPendingAction = dbPendingOdoAction?.type === "odometro";
  // Marcador en el hilo bloquea arranque en blanco. El payload en DB solo sirve para
  // procesar CONFIRMO cuando el agente parafraseó el resumen — no debe resucitar un
  // trámite abandonado si el cliente pide uno nuevo (bug producción 2026-07-29).
  const hasThreadPendingConfirm = hasPendingOdometerConfirmation(preliminaryThreadText);
  const hasPendingConfirmInThread =
    hasLiveOdometerPendingAction && hasThreadPendingConfirm;
  const hasUnitHintInCurrentMessage =
    looksLikeFleetUnitSearchInput(rawText) || looksLikeUnitNameInMessage(rawText);
  const isOdometerReminder = looksLikeOdometerFlowReminder(rawText);
  const supersedesPendingConfirm = clientSupersedesOdometerConfirmation(
    rawText,
    preliminaryThreadText,
    {
      liveOdometerPending:
        hasLiveOdometerPendingAction && !!dbPendingOdoAction?.payload,
    },
  );
  // Bug real, producción 2026-08-05: "quiero hacer otro ajuste de odómetro en la misma
  // unidad" DEBE reiniciar el valor (pedir km nuevo) aunque conserve la patente por
  // referencia vaga. Antes `!explicitVagueUnitReference` bloqueaba el arranque en blanco
  // y reusaba el km viejo del hilo (además corruptible a 2699000 por concat fecha+km).
  const freshOdometerRestart =
    odometerFlowStart &&
    !hasUnitHintInCurrentMessage &&
    looksLikeFreshOdometerRestartRequest(rawText);
  // Bug real, producción 2026-07-29: el propio prompt del BOT ("Para registrar el cambio
  // de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB
  // 006 EX...)") matcheaba looksLikeFleetUnitSearchInput por la patente de EJEMPLO ("AB
  // 006 EX") — este chequeo se calculaba sobre TODAS las líneas del hilo (bot + cliente),
  // así que "threadHasPriorOdometerUnitRequest" daba true por texto del propio bot, no del
  // cliente. Con eso, un pedido nuevo tras cerrar la conversación ("Ok" → "De nada,
  // ¿necesitás algo más?" → nuevo "quiero cambiar...odómetro") NO se trataba como arranque
  // en blanco, y el hilo VIEJO completo (con la patente/km de un trámite ya abandonado)
  // volvía a colarse en el resumen de confirmación. Se excluyen las líneas que son
  // literalmente el prompt del bot pidiendo la patente.
  const threadHasPriorOdometerUnitRequest = preliminaryThreadText
    .split("\n")
    .filter((line) => !/^para registrar el cambio de (od[oó]metro|hor[oó]metro)/i.test(line.trim()))
    .some(
      (line) =>
        looksLikeExplicitOdometerUpdateRequest(line) &&
        (looksLikeFleetUnitSearchInput(line) || looksLikeUnitNameInMessage(line)),
    );
  // Bug real, producción 2026-07-29 (mismo caso): aunque no hubiera confirmación pendiente
  // (hasPendingConfirmInThread=false), el trámite podía seguir sin tratarse como blanco si
  // threadHasPriorOdometerUnitRequest daba (falsamente) true. isOdometerFlowSuperseded ya
  // detecta explícitamente que la conversación siguió a otra cosa (cambio de tema, cierre
  // con "de nada", etc.) — si eso pasó, un pedido nuevo de odómetro/horómetro SIEMPRE debe
  // arrancar en blanco, sin importar qué diga el resto del hilo viejo.
  const priorFlowExplicitlySuperseded = isOdometerFlowSuperseded(preliminaryThreadText);
  const treatAsBlankFlowStart =
    odometerFlowStart &&
    !hasUnitHintInCurrentMessage &&
    !isOdometerReminder &&
    (horometerOnlyIntent ||
      supersedesPendingConfirm ||
      freshOdometerRestart ||
      priorFlowExplicitlySuperseded ||
      (!explicitVagueUnitReference &&
        !hasPendingConfirmInThread &&
        !threadHasPriorOdometerUnitRequest));
  if (treatAsBlankFlowStart || supersedesPendingConfirm) {
    await clearPendingAction(prisma, rawPhone);
  }
  const fromText = parseFromText(rawText);
  const threadText = treatAsBlankFlowStart || supersedesPendingConfirm ? "" : preliminaryThreadText;
  const prefixInMessageEarly = extractPlatePrefixFromMessage(rawText);
  const explicitRejectionEarly = looksLikeUnitRejection(rawText);
  const plateCorrectionEarly = looksLikePlateCorrectionRequest(rawText);
  const explicitUnitNameInMessage = extractExplicitUnitNameFromText(rawText);
  const explicitPlateInCurrentMessage = detectLoosePlate(rawText);
  const correctingUnitDuringPendingConfirm =
    !treatAsBlankFlowStart &&
    !supersedesPendingConfirm &&
    hasLiveOdometerPendingAction &&
    (hasPendingOdometerConfirmation(threadText) || !!dbPendingOdoAction?.payload) &&
    (prefixInMessageEarly ||
      explicitRejectionEarly ||
      plateCorrectionEarly ||
      shouldClearOdometerPlateFromThread(rawText) ||
      (!!explicitPlateInCurrentMessage && !looksLikeVagueUnitReference(rawText)));
  if (correctingUnitDuringPendingConfirm) {
    await clearPendingAction(prisma, rawPhone);
  }
  const flowThreadText = threadText || preliminaryThreadText;
  const activeOdoFlow = threadHasActiveOdometerFlow(flowThreadText);

  if (
    hasPendingConfirmInThread &&
    !supersedesPendingConfirm &&
    looksLikeOdometerConfirmationRejection(rawText)
  ) {
    await clearPendingAction(prisma, rawPhone);
    const message =
      "Entendido, no registro ese cambio. ¿Qué necesitás? Podés pedirme otro trámite (odómetro, horómetro, certificado, estado de unidad, etc.).";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: "flow_cancelled_early",
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        message,
        topicChange_s: "true",
        cancelled_s: "true",
      },
      { status: BB_STATUS },
    );
  }

  // Bug real, producción 2026-07-29: "quiero cambiar un odómetro" terminaba pidiendo
  // horómetro. Causa: `mentionsHorometroIntent(flowThreadText)` es un chequeo SIN acotar
  // (¿aparece "horómetro" en cualquier parte de los últimos 48 mensajes del ticket?), y
  // `flowThreadText` además reincorpora el hilo COMPLETO sin recortar apenas `threadText`
  // queda en "" por un arranque en blanco (fallback `threadText || preliminaryThreadText`
  // de más arriba). Una mención de "horómetro" de un trámite viejo YA resuelto, minutos u
  // horas antes en la misma conversación, contaminaba un pedido nuevo de odómetro sin
  // relación. Reemplazado por threadAwaitingHorometerPlate/KmValue (ya usadas en el resto
  // del archivo): estas SÍ están acotadas a los últimos ~2500 caracteres y solo matchean
  // el prompt EXACTO que el propio bot mandó pidiendo horómetro — no cualquier mención
  // vieja de la palabra.
  //
  // Además, si el cliente corregía explícitamente ("No, odómetro") DESPUÉS de que el bot
  // ya preguntó por horómetro, esa corrección se ignoraba: el hilo (con la propia
  // pregunta del bot mencionando "horómetro") pesaba más que lo que el cliente acababa de
  // escribir, y el bot repetía la misma pregunta en loop sin dejarlo corregir. Ahora una
  // mención EXPLÍCITA del campo en el mensaje actual (rawText) tiene prioridad sobre
  // cualquier señal del hilo.
  const rawExplicitlyMentionsOdometroOnly =
    /\bod[oó]metro\b/i.test(rawText) && !/\bhor[oó]metro\b/i.test(rawText);
  // Desempate por recencia: threadAwaitingHorometerPlate/KmValue y sus equivalentes de
  // odómetro solo miran SI el prompt exacto del bot aparece en el tail (~2500 caracteres),
  // no CUÁL de los dos es el más reciente. Bug real, producción 2026-07-29: tras el fix
  // anterior, "no perdon quierocambiar odometro" SÍ logró que el bot preguntara "¿Cuál es
  // el nuevo odómetro en km?" — pero esa pregunta NUEVA convivía en el mismo tail con la
  // pregunta VIEJA de horómetro (de un intercambio previo, ya corregido, a pocos mensajes
  // de distancia). Al llegar la respuesta numérica "125852" (sin mencionar el campo),
  // threadAwaitingHorometerKmValue seguía dando true por esa pregunta vieja — el trámite
  // volvía a tratarse como horómetro pese a que la pregunta ACTIVA (la última) era de
  // odómetro. Si ambas señales están presentes, gana la que aparece más tarde en el texto.
  const horometerAwaitingInThread =
    threadAwaitingHorometerPlate(threadText) || threadAwaitingHorometerKmValue(threadText);
  const odometerAwaitingInThread =
    threadAwaitingOdometerPlate(threadText) || threadAwaitingOdometerKmValue(threadText);
  const sessionNotebook = await getSessionNotebook(prisma, rawPhone);
  const notebookHorometerFlow =
    isConversationNotebookEnabled() && notebookIndicatesHorometerFlow(sessionNotebook);
  const tomoMeterKindInThread = lastTomoMeterKindInThreadTail(flowThreadText);
  let horometerFlowActive = rawExplicitlyMentionsOdometroOnly || tomoMeterKindInThread === "odometro"
    ? false
    : horometerOnlyIntent ||
      notebookHorometerFlow ||
      tomoMeterKindInThread === "horometro" ||
      (horometerAwaitingInThread &&
        !(odometerAwaitingInThread && lastAwaitingFieldPromptInTail(threadText) === "odometro"));
  const plateCorrection = looksLikePlateCorrectionRequest(rawText);
  const unitHintInMessage =
    looksLikeVehicleBrandOrUnitSearch(rawText) || /\bpatente\s+(?:de|del)\b/i.test(rawText);
  // Rechazo explícito ("no quiero esa, es otra") sin marca/patente alternativa: igual que
  // una corrección de patente, no corresponde reutilizar ninguna patente vieja del hilo
  // ni la unidad activa — bug real, producción 2026-07-23 (mismo mecanismo que en
  // unidades/route.ts, ver looksLikeUnitRejection en @/lib/wara).
  const explicitRejection = looksLikeUnitRejection(rawText);
  const skipThreadPlate =
    treatAsBlankFlowStart ||
    supersedesPendingConfirm ||
    correctingUnitDuringPendingConfirm ||
    explicitRejection ||
    (activeOdoFlow && (plateCorrection || unitHintInMessage));

  // Arranque en blanco vacía inferencia de patente DESDE el hilo, pero no la unidad activa
  // en DB (p. ej. tras mantenimiento recién registrado para AG562SP).
  const skipActiveUnitFallback =
    correctingUnitDuringPendingConfirm ||
    explicitRejection ||
    (activeOdoFlow && (plateCorrection || unitHintInMessage));

  const activeUnitRecordEarly = skipActiveUnitFallback
    ? null
    : await getActiveUnit(prisma, rawPhone);
  const contextUnitPlate = resolveContextUnitPlate({
    sessionNotebook,
    activeUnitPlate: activeUnitRecordEarly?.plate,
  });

  if (looksLikeGreeting(rawText) && !shouldContinueOdometerFlow(rawText, threadText)) {
    const pendingPayload =
      dbPendingOdoAction?.type === "odometro" ? dbPendingOdoAction.payload : undefined;
    const resumePlateRaw =
      (pendingPayload?.patente ? String(pendingPayload.patente) : null) || contextUnitPlate;
    const awaitingKmOnly =
      threadAwaitingOdometerKmValue(flowThreadText) ||
      threadAwaitingHorometerKmValue(flowThreadText);
    const awaitingOdometerInput =
      awaitingKmOnly ||
      threadAwaitingOdometerPlate(flowThreadText) ||
      threadAwaitingHorometerPlate(flowThreadText) ||
      (hasLiveOdometerPendingAction &&
        !!resumePlateRaw &&
        typeof pendingPayload?.odometro !== "number" &&
        typeof pendingPayload?.horometro !== "number" &&
        !hasThreadPendingConfirm);
    if (resumePlateRaw && awaitingOdometerInput && !hasThreadPendingConfirm) {
      const wantsHorometroResume =
        horometerFlowActive ||
        horometerOnlyIntent ||
        pendingPayload?.meterType === "horometro";
      const unitLabel = formatFleetUnitLabel(
        formatPlateWithSpaces(resumePlateRaw) ?? resumePlateRaw,
        pendingPayload?.unidad ? String(pendingPayload.unidad) : null,
      );
      const pendingHoro =
        typeof pendingPayload?.horometro === "number" ? pendingPayload.horometro : undefined;
      const pendingOdo =
        typeof pendingPayload?.odometro === "number" ? pendingPayload.odometro : undefined;
      const hasPartialValue = wantsHorometroResume
        ? pendingHoro != null
        : pendingOdo != null;
      const message = hasPartialValue
        ? formatMeterAsk({
            meter: wantsHorometroResume ? "hourmeter" : "odometer",
            unitLabel,
            expected: "datetime",
          })
        : formatMeterAsk({
            meter: wantsHorometroResume ? "hourmeter" : "odometer",
            unitLabel,
            expected: "value",
          });
      const tail = flowThreadText.slice(-1200);
      if (tail.includes(message.trim())) {
        return NextResponse.json(
          {
            ok: true,
            ok_s: "true",
            flowComplete_s: "true",
            message: "",
            skipResponse_s: "true",
            duplicatePrompt_s: "true",
          },
          { status: BB_STATUS },
        );
      }
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "greeting_resume_meter_ask",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Falta odómetro u horómetro", message },
        { status: BB_STATUS },
      );
    }
  }

  if (
    !odometerFlowStart &&
    !isConfirmed(rawText) &&
    !looksLikePendingTramiteAffirmation(rawText) &&
    (looksLikeOpcionesInfoRequest(rawText) ||
      looksLikeUnidadesInfoRequest(rawText) ||
      looksLikeGreeting(rawText) ||
      looksLikeConversationAcknowledgement(rawText) ||
      (looksLikeNonOdometerOperationalIntent(rawText) && !plateCorrection) ||
      isOdometerFlowSuperseded(threadText)) &&
    !shouldContinueOdometerFlow(rawText, threadText)
  ) {
    if (looksLikeGreeting(rawText)) {
      await clearPendingAction(prisma, rawPhone);
    }
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        message: "",
        skipResponse_s: "true",
        topicChange_s: "true",
      },
      { status: BB_STATUS },
    );
  }

  const historialForExtract =
    treatAsBlankFlowStart || supersedesPendingConfirm
      ? ""
      : stripBotOdometerBotSpeech(flowThreadText);
  const threadParsed = parseFromText(historialForExtract);
  // Bug real, producción 2026-07-28: parseFromText() usa detectPlate(), que devuelve la
  // PRIMERA patente de TODO el texto, no la más reciente. Con varias patentes en el hilo
  // (ej. una lista de candidatos "OST 223, OST 226, OST 224, OST 225" antes de que el
  // cliente confirme "OST 224"), el resumen final terminaba anclado a la primera opción
  // listada en vez de la unidad realmente elegida. Mismo patrón que el bug histórico de
  // más abajo (comentario "detectPlate(threadText) devuelve la PRIMERA patente..."),
  // corregido ahí con extractLastPlateFromThread — pero ese fix corre DESPUÉS de este
  // merge y nunca llegaba a corregir mergedFields.patente. Se aplica la misma corrección acá.
  if (historialForExtract) {
    const lastPlateForExtract = extractLastPlateFromThread(historialForExtract);
    if (lastPlateForExtract) threadParsed.patente = lastPlateForExtract;
  }
  const mergedFields = await resolveOdometerHorometerFields({
    tramite: horometerFlowActive || horometerOnlyIntent ? "horometro" : "odometro",
    mensaje: rawText,
    historial: historialForExtract,
    horometerFlowActive,
    treatAsBlankFlowStart: treatAsBlankFlowStart || supersedesPendingConfirm,
    activeUnitPlate: contextUnitPlate,
    timezone: "America/Argentina/Buenos_Aires",
    regexMessage: fromText,
    regexThread: historialForExtract ? threadParsed : {},
  });
  // detectPlate(threadText) devuelve la PRIMERA patente que aparece en todo el hilo
  // (los últimos 24 mensajes), no la más reciente. Bug real, producción 2026-07-23:
  // el cliente pidió cambiar el odómetro de "la nissan", el bot resolvió y confirmó
  // "tomo AG 562 SP", pero al mandar el km nuevo el registro se intentó contra "OST
  // 223" (una patente mencionada antes en la misma conversación por otro trámite).
  // extractLastPlateFromThread recorre el hilo de más reciente a más antiguo.
  const lastThreadPlate = skipThreadPlate ? null : extractLastPlateFromThread(flowThreadText);

  if (plateCorrection && activeOdoFlow && !extractPlateCorrectionHint(rawText) && !fromText.patente) {
    const message =
      "Entendido. ¿Cuál es la patente correcta? Podés pasarme la matrícula (ej. AB 123 CD) o el nombre/marca de la unidad.";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: "plate_correction",
    });
    return NextResponse.json(
      { ok: false, ok_s: "false", error: "Patente requerida", message },
      { status: BB_STATUS },
    );
  }

  // "Unidad activa" (@/lib/activeUnit): respaldo cuando ni el mensaje ni el hilo traen
  // ninguna patente reconocible, pero venimos de resolver una unidad hace poco en
  // CUALQUIER trámite (estado/certificado/mantenimiento). Nunca se usa cuando
  // skipThreadPlate ya indica que el cliente está señalando explícitamente OTRA
  // unidad (corrección de patente o marca/nombre distinto en el mensaje).
  const activeUnitRecord = activeUnitRecordEarly;
  // CONFIRMO / sí / dale NO son búsqueda de flota (bug 2026-08-07: «CONFIRMO» → no encontré unidad).
  const isFleetUnitSelection =
    looksLikeFleetUnitSearchInput(rawText) &&
    !isConfirmed(rawText) &&
    !looksLikeBriefConfirmation(rawText);
  const prefixInMessage = extractPlatePrefixFromMessage(rawText);
  const plateInMessage = normalizePlate(fromText.patente ?? detectPlate(rawText) ?? "");
  let explicitMessagePlate = normalizePlate(parsed.data.patente ?? parsed.data.plate ?? plateInMessage ?? "");
  // Bug real, producción 2026-07-30: "Unidad: M600-020" + km no debe heredar AF 061 DV
  // del certificado/hilo/IA — la unidad nombrada explícitamente manda.
  if (shouldClearOdometerPlateFromThread(rawText)) {
    explicitMessagePlate = explicitPlateInCurrentMessage
      ? normalizePlate(explicitPlateInCurrentMessage)
      : "";
  }
  // Bug 2026-07-27: mergedFields/IA inferían OST223 del hilo y resolvePlateWithWaraFleet
  // los tomaba como directPlate — saltaba búsqueda por prefijo MYQ/RMX.
  if (
    !isFleetUnitSelection &&
    !prefixInMessage &&
    !shouldClearOdometerPlateFromThread(rawText) &&
    mergedFields.patente
  ) {
    explicitMessagePlate = normalizePlate(explicitMessagePlate || mergedFields.patente);
  }
  const awaitingOdometerKm = threadAwaitingOdometerKmValue(flowThreadText);
  const awaitingHorometerKm = threadAwaitingHorometerKmValue(flowThreadText);
  const lockedPlateFromTomoRaw =
    awaitingHorometerKm || awaitingOdometerKm
      ? extractPlateFromPerfectoTomo(flowThreadText)
      : undefined;
  const lockedPlateFromTomo =
    lockedPlateFromTomoRaw && shouldClearOdometerPlateFromThread(rawText)
      ? undefined
      : lockedPlateFromTomoRaw;
  const clockTimeOnlyReading = looksLikeClockTimeOnlyReading(rawText);
  const awaitingPlateSelection =
    (threadAwaitingOdometerPlate(flowThreadText) && !awaitingOdometerKm) ||
    (threadAwaitingHorometerPlate(flowThreadText) && !awaitingHorometerKm) ||
    (activeOdoFlow &&
      !hasPendingConfirmInThread &&
      !awaitingOdometerKm &&
      !awaitingHorometerKm);
  const freshOdometerIntentWithoutUnit =
    odometerIntentStart &&
    !hasUnitHintInCurrentMessage &&
    !explicitVagueUnitReference &&
    !isFleetUnitSelection;

  let patente = lockedPlateFromTomo
    ? normalizePlate(lockedPlateFromTomo)
    : explicitMessagePlate;

  // Bug real 2026-07-27: "La q empieza con RMX" tomaba OST 223 del hilo/unidad activa
  // porque resolveOdometerContextPlate corría ANTES que la flota. Prefijo/marca/patente
  // en el mensaje actual → SIEMPRE resolvePlateWithWaraFleet (IA + reglas).
  if (
    !lockedPlateFromTomo &&
    (isFleetUnitSelection ||
      correctingUnitDuringPendingConfirm ||
      (awaitingPlateSelection && rawText.trim())) &&
    !clockTimeOnlyReading
  ) {
    const fleetPlate = await resolvePlateWithWaraFleet(
      prisma,
      rawPhone,
      rawText,
      flowThreadText,
      null,
      {
        preferAi: !explicitUnitNameInMessage,
        odometerContext: true,
      },
    );
    if (fleetPlate.ok) {
      patente = fleetPlate.plate;
    } else if (fleetPlate.reason === "clarification") {
      await appendOutboundBotMessage(rawPhone, fleetPlate.message, {
        source: "wara_odometro_response",
        stage: "unit_clarification",
      });
      return NextResponse.json(
        {
          ok: false,
          ok_s: "false",
          error: "Varias unidades",
          message: fleetPlate.message,
        },
        { status: BB_STATUS },
      );
    } else if (isFleetUnitSelection) {
      patente = "";
    }
  }

  if (!patente && !skipThreadPlate && !isFleetUnitSelection && !freshOdometerIntentWithoutUnit) {
    patente = normalizePlate(
      resolveOdometerContextPlate({
        threadText: flowThreadText,
        lastThreadPlate,
        activeUnitPlate: contextUnitPlate,
        explicitVagueUnitReference,
        hasPendingOdometerConfirm:
          hasPendingConfirmInThread && !correctingUnitDuringPendingConfirm,
      }) ?? "",
    );
  } else if (
    !patente &&
    !skipThreadPlate &&
    !isFleetUnitSelection &&
    freshOdometerIntentWithoutUnit &&
    explicitVagueUnitReference
  ) {
    patente = normalizePlate(
      resolveOdometerContextPlate({
        threadText: flowThreadText,
        lastThreadPlate,
        activeUnitPlate: contextUnitPlate,
        explicitVagueUnitReference: true,
        hasPendingOdometerConfirm:
          hasPendingConfirmInThread && !correctingUnitDuringPendingConfirm,
      }) ?? "",
    );
  } else if (
    !patente &&
    ((freshOdometerIntentWithoutUnit && shouldUseActiveUnitFallback(rawText)) ||
      (treatAsBlankFlowStart &&
        explicitVagueUnitReference &&
        shouldUseActiveUnitFallback(rawText))) &&
    contextUnitPlate
  ) {
    // Bug real, producción 2026-07-30: "Podemos cambiar el odómetro?" tras certificado o
    // consulta GPS tenía activeUnit (AD 626 UG) pero freshOdometerIntentWithoutUnit
    // bloqueaba resolveOdometerContextPlate y odometerFlowStart bloqueaba el fallback
    // de activeUnit — pedía patente de cero pese a la unidad recién usada.
    // Bug 2026-08-05: "otro ajuste ... misma unidad" ahora es blank (limpia km) pero
    // debe conservar la patente vía activeUnit / referencia vaga.
    patente = normalizePlate(contextUnitPlate);
  } else if (
    !patente &&
    treatAsBlankFlowStart &&
    explicitVagueUnitReference
  ) {
    patente = normalizePlate(
      resolveOdometerContextPlate({
        threadText: preliminaryThreadText,
        lastThreadPlate,
        activeUnitPlate: contextUnitPlate,
        explicitVagueUnitReference: true,
        hasPendingOdometerConfirm: false,
      }) ?? "",
    );
  }

  if (!patente && !odometerFlowStart && !isFleetUnitSelection && !clockTimeOnlyReading) {
    const fleetPlate = await resolvePlateWithWaraFleet(
      prisma,
      rawPhone,
      rawText,
      flowThreadText
    );
    if (fleetPlate.ok) {
      patente = fleetPlate.plate;
    } else if (fleetPlate.reason === "clarification") {
      return NextResponse.json(
        { ok: false, error: "Varias unidades", message: fleetPlate.message },
        { status: BB_STATUS }
      );
    } else if (shouldUseActiveUnitFallback(rawText) && contextUnitPlate) {
      patente = contextUnitPlate;
    }
  } else if (skipThreadPlate && !patente && activeOdoFlow && !isFleetUnitSelection && !clockTimeOnlyReading) {
    const fleetPlate = await resolvePlateWithWaraFleet(prisma, rawPhone, rawText, flowThreadText);
    if (fleetPlate.ok) {
      patente = fleetPlate.plate;
    } else if (fleetPlate.reason === "clarification") {
      return NextResponse.json(
        { ok: false, error: "Varias unidades", message: fleetPlate.message },
        { status: BB_STATUS },
      );
    }
  }

  // Bug real, producción 2026-07-23 (mismo caso de "Aun no te dije la hora..."):
  // estos tres puntos seguían mirando `odometerFlowStart` (arranque de trámite en el
  // mensaje actual), no `treatAsBlankFlowStart` (arranque REALMENTE en blanco). Con
  // una confirmación pendiente en el hilo, `odometerFlowStart` sigue siendo true
  // (el mensaje actual menciona "cambio de odometro"), así que el km/hs ya
  // propuestos en la confirmación pendiente (ej. 600 km) se descartaban igual,
  // aunque ya no se vaciara el hilo.
  // Mismo gate por TTL que hasPendingConfirmInThread más arriba (ver comentario ahí):
  // sin un pendingAction "odometro" vigente en la base, no se trata como confirmación
  // pendiente real aunque el texto del hilo todavía diga "respondé CONFIRMO".
  const pendingOdoConfirm =
    supersedesPendingConfirm || correctingUnitDuringPendingConfirm
      ? false
      : (hasLiveOdometerPendingAction &&
          (hasPendingOdometerConfirmation(threadText) || !!dbPendingOdoAction?.payload)) ||
        threadAwaitingOdometerConfirmDetails(threadText) ||
        (hasPendingOdometerConfirmation(threadText) && !isOdometerFlowSuperseded(threadText));
  const confirmWithSupplement =
    pendingOdoConfirm &&
    looksLikePendingTramiteAffirmation(rawText) &&
    looksLikeOdometerPendingDataAmendment(rawText);
  const bareNumericAmendmentValue = pendingOdoConfirm
    ? (parseBareNumericPendingAmendment(rawText) ?? parseInlineNumericCorrection(rawText))
    : undefined;
  const amendsPendingOdoConfirm =
    pendingOdoConfirm &&
    !confirmWithSupplement &&
    (looksLikeOdometerPendingDataAmendment(rawText) || bareNumericAmendmentValue !== undefined);
  const effectivePendingOdoConfirm = pendingOdoConfirm && !amendsPendingOdoConfirm;
  const explicitKmInMessage = messageExplicitlyStatesKm(rawText);
  // Saludo / "hola Atilio" (p.ej. audio) no aporta km/fecha: no reutilizar ejemplos del hilo.
  const nonDataCustomerTurn =
    (looksLikeBareAtilioMention(rawText) || looksLikeGreeting(rawText)) &&
    !/\d/.test(rawText) &&
    !looksLikeAhoraComoFechaLectura(rawText);
  // Km explícitos del mensaje actual SIEMPRE ganan sobre hilo/pending/IA (bug 2026-08-07:
  // "Los kilómetros son 8900" y el bot seguía con 10500 del "Tomé …" anterior).
  const kmFromCurrentMessage = firstFiniteNumber(
    extractOdometroFromOdometerContext(rawText),
    parseFromText(rawText).odometro,
    awaitingOdometerKm ? parseBareOdometerKm(rawText) : undefined,
  );
  const allowThreadKm =
    !nonDataCustomerTurn &&
    !kmFromCurrentMessage &&
    (explicitKmInMessage ||
      effectivePendingOdoConfirm ||
      awaitingOdometerKm ||
      (!isFleetUnitSelection && !awaitingPlateSelection));

  const bareKmInMessage = awaitingOdometerKm ? parseBareOdometerKm(rawText) : undefined;
  const bareHorometerInMessage = awaitingHorometerKm ? parseBareHorometerHours(rawText) : undefined;

  const rawOdometro = firstFiniteNumber(
    parsed.data.odometro,
    parsed.data.odometer,
    kmFromCurrentMessage,
    !horometerFlowActive && !horometerOnlyIntent ? bareNumericAmendmentValue : undefined,
    bareKmInMessage,
    fromText.odometro,
    nonDataCustomerTurn || kmFromCurrentMessage ? undefined : mergedFields.odometro,
    horometerFlowActive || horometerOnlyIntent
      ? undefined
      : treatAsBlankFlowStart
        ? undefined
        : allowThreadKm
          ? threadParsed.odometro
          : undefined,
  );
  let odometro = isPlausibleOdometerReading(rawOdometro, rawText, {
    pendingConfirm: pendingOdoConfirm,
    explicitKmInMessage,
    awaitingKmValue: awaitingOdometerKm,
  })
    ? rawOdometro
    : undefined;
  // Solo eligió unidad (ej. "Es la saveiro"): no inventar/arrastrar km del bot.
  if (
    typeof kmFromCurrentMessage !== "number" &&
    !explicitKmInMessage &&
    !bareKmInMessage &&
    !bareNumericAmendmentValue &&
    !effectivePendingOdoConfirm &&
    (looksLikeVehicleBrandOrUnitSearch(rawText) ||
      looksLikeFleetUnitSearchInput(rawText) ||
      looksLikeUnitNameInMessage(rawText))
  ) {
    odometro = undefined;
  } else if (typeof kmFromCurrentMessage === "number") {
    odometro = kmFromCurrentMessage;
  }
  const combinedText = [flowThreadText, rawText].filter(Boolean).join("\n");
  const clockScanText = [rawText, flowThreadText.slice(-800)].filter(Boolean).join("\n");
  let horometro = stripHorometroConfusedWithClockTime(
    rawText,
    resolveHorometroForWara({
      explicitHorometro: firstFiniteNumber(parsed.data.horometro, parsed.data.hourmeter),
      parsedHorometro: firstFiniteNumber(
        (horometerFlowActive || horometerOnlyIntent) ? bareNumericAmendmentValue : undefined,
        mergedFields.horometro,
        bareHorometerInMessage,
        fromText.horometro,
        treatAsBlankFlowStart ? undefined : threadParsed.horometro,
      ),
      combinedText: treatAsBlankFlowStart ? rawText : combinedText,
    }),
    clockScanText,
  );

  const fechaFromMessageEarly = parseFechaFromText(rawText, "America/Argentina/Buenos_Aires");
  if (
    hasLiveOdometerPendingAction &&
    !pendingOdoConfirm &&
    dbPendingOdoAction?.payload
  ) {
    const payload = dbPendingOdoAction.payload;
    if (typeof horometro !== "number" && typeof payload.horometro === "number") {
      horometro = payload.horometro as number;
    }
    if (typeof odometro !== "number" && typeof payload.odometro === "number") {
      odometro = payload.odometro as number;
    }
  }
  if (
    (awaitingHorometerKm || horometerFlowActive) &&
    fechaFromMessageEarly &&
    !bareHorometerInMessage &&
    typeof fromText.horometro !== "number" &&
    typeof horometro !== "number"
  ) {
    horometro = undefined;
  }

  const strippedMeters = stripMeterValuesMatchingUnitReference(rawText, { odometro, horometro });
  odometro = strippedMeters.odometro;
  horometro = strippedMeters.horometro;

  if (
    (horometerFlowActive || horometerOnlyIntent || awaitingHorometerKm) &&
    !explicitKmInMessage &&
    !messageExplicitlyStatesKm(rawText)
  ) {
    odometro = undefined;
  }

  // Fecha ya confirmada en el resumen pendiente, para no perderla si la corrección de
  // este turno no la vuelve a mencionar (ver uso en fechaExplicita más abajo).
  let pendingPayloadFecha: string | undefined;
  if (amendsPendingOdoConfirm) {
    // amendsPendingOdoConfirm ⇒ pendingOdoConfirm ⇒ hasLiveOdometerPendingAction, así que
    // dbPendingOdoAction (ya obtenido más arriba) es el mismo registro vigente — se evita
    // una segunda consulta redundante a la base.
    const payload = dbPendingOdoAction?.payload;
    if (payload) {
      if (
        !patente &&
        payload.patente &&
        !shouldClearOdometerPlateFromThread(rawText) &&
        !explicitPlateInCurrentMessage
      ) {
        patente = normalizePlate(String(payload.patente));
      }
      if (typeof horometro !== "number" && typeof payload.horometro === "number") {
        horometro = payload.horometro as number;
      }
      if (typeof odometro !== "number" && typeof payload.odometro === "number") {
        odometro = payload.odometro as number;
      }
      if (typeof payload.fecha === "string" && payload.fecha.trim()) {
        pendingPayloadFecha = payload.fecha;
      }
    }
    await clearPendingAction(prisma, rawPhone);
  }

  if (
    looksLikeOdometerConfirmationRejection(rawText) &&
    (pendingOdoConfirm ||
      activeOdoFlow ||
      threadHasActiveOdometerFlow(flowThreadText) ||
      (horometerFlowActive && (patente || typeof horometro === "number" || typeof odometro === "number")))
  ) {
    await clearPendingAction(prisma, rawPhone);
    const message =
      "Entendido, no registro ese cambio. ¿Qué necesitás? Podés pedirme otro trámite (odómetro, horómetro, certificado, estado de unidad, etc.).";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: "flow_cancelled",
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        message,
        topicChange_s: "true",
        cancelled_s: "true",
      },
      { status: BB_STATUS },
    );
  }

  if (!patente) {
    if (
      shouldUseActiveUnitFallback(rawText) &&
      contextUnitPlate
    ) {
      patente = normalizePlate(contextUnitPlate);
    } else if (treatAsBlankFlowStart) {
      const fallbackTemplate = horometerOnlyIntent
        ? formatAskUnit("hourmeter")
        : formatAskUnit("odometer");
      const message = await composeOdometerDialogueReply({
        situation: "missing_plate",
        history: flowThreadText,
        lastCustomerMessage: rawText,
        fallbackTemplate,
      });
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_plate",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Patente requerida", message },
        { status: BB_STATUS },
      );
    }
    const hintText =
      shouldClearOdometerPlateFromThread(rawText) || explicitPlateInCurrentMessage
        ? rawText
        : [rawText, flowThreadText].filter(Boolean).join("\n");
    const fleetPlate = await resolvePlateWithWaraFleet(
      prisma,
      rawPhone,
      hintText,
      shouldClearOdometerPlateFromThread(rawText) ? rawText : flowThreadText,
      null,
      {
        preferAi: !explicitUnitNameInMessage,
        odometerContext: true,
      },
    );
    if (fleetPlate.ok) {
      patente = fleetPlate.plate;
    } else if (fleetPlate.reason === "clarification") {
      await appendOutboundBotMessage(rawPhone, fleetPlate.message, {
        source: "wara_odometro_response",
        stage: "unit_clarification",
      });
      return NextResponse.json(
        {
          ok: false,
          ok_s: "false",
          error: "Varias unidades",
          message: fleetPlate.message,
        },
        { status: BB_STATUS },
      );
    } else if (shouldUseActiveUnitFallback(hintText) && contextUnitPlate) {
      patente = contextUnitPlate;
    } else {
      const message =
        `No identifiqué la unidad en tu flota. Decime la patente (con guiones si querés), una marca/nombre (ej. Nissan) o escribí "listado de mis unidades".`;
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_plate",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Patente inválida", message },
        { status: BB_STATUS },
      );
    }
  }
  if (
    !patente &&
    ((typeof horometro === "number" && Number.isFinite(horometro)) ||
      (typeof odometro === "number" && Number.isFinite(odometro)))
  ) {
    const fleetResolved = await resolvePatenteFromFleetForMeterTramite({
      rawPhone,
      rawText,
      flowThreadText,
      explicitUnitNameInMessage,
    });
    if (fleetResolved.kind === "clarification") return fleetResolved.response;
    if (fleetResolved.kind === "resolved") patente = fleetResolved.patente;
  }
  if (!(typeof odometro === "number" && Number.isFinite(odometro)) && !(typeof horometro === "number" && Number.isFinite(horometro))) {
    // Bug real, producción 2026-07-28: la "unidad activa" (usada como respaldo por
    // OTROS trámites cuando no hay patente explícita) solo se actualizaba al completar
    // el registro con éxito. Si el trámite quedaba a medias en este paso intermedio
    // (pidiendo las horas/km), activeUnit seguía apuntando a una consulta vieja de
    // OTRO trámite (ej. una consulta de GPS de varios minutos antes) — y ese valor
    // desactualizado terminaba filtrándose en un resumen posterior. Se actualiza acá
    // también, apenas se confirma la patente, no solo al final.
    const wantsHorometro = horometerFlowActive;
    const meterType = resolveMeterNotebookType({ horometerFlowActive, horometerOnlyIntent });
    if (!patente) {
      const fleetResolved = await resolvePatenteFromFleetForMeterTramite({
        rawPhone,
        rawText,
        flowThreadText,
        explicitUnitNameInMessage,
      });
      if (fleetResolved.kind === "clarification") return fleetResolved.response;
      if (fleetResolved.kind === "resolved") patente = fleetResolved.patente;
    }
    if (!patente) {
      const fallbackTemplate = horometerOnlyIntent
        ? formatAskUnit("hourmeter")
        : formatAskUnit("odometer");
      const message = await composeOdometerDialogueReply({
        situation: "missing_plate",
        history: flowThreadText,
        lastCustomerMessage: rawText,
        fieldHint: wantsHorometro ? "horometro" : "odometro",
        fallbackTemplate,
      });
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_plate",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Patente requerida", message },
        { status: BB_STATUS },
      );
    }
    // Bug real 2026-08-06: no pedir km hasta validar la unidad en flota.
    // "unidad 2408437" (ID numérico) y patentes inventadas por IA no deben avanzar.
    {
      const sessionEarly = await resolveWaraSessionByPhone(prisma, rawPhone);
      const companyEarly = sessionEarly.companyName?.trim() || "tu empresa";
      const bareNumeric = looksLikeBareNumericUnitId(patente);
      const fleetCheckEarly = await validatePlateInFleetForPhone(
        prisma,
        rawPhone,
        patente,
        companyEarly,
        "odometer",
      );
      if (!fleetCheckEarly.found && fleetCheckEarly.checked) {
        const fallbackTemplate =
          fleetCheckEarly.message ||
          `No encontré la unidad ${formatPlateWithSpaces(patente) ?? patente} en la flota de ${companyEarly}. Pasame la patente (ej. AB 006 EX) o el nombre interno (ej. M300-097).`;
        const message = await composeOdometerDialogueReply({
          situation: "error_not_found",
          history: flowThreadText,
          lastCustomerMessage: rawText,
          fieldHint: wantsHorometro ? "horometro" : "odometro",
          fallbackTemplate,
        });
        await appendOutboundBotMessage(rawPhone, message, {
          source: "wara_odometro_response",
          stage: "plate_not_in_fleet",
          patente,
          companyName: companyEarly,
        });
        return NextResponse.json(
          { ok: false, ok_s: "false", error: "Patente no encontrada en flota", message },
          { status: BB_STATUS },
        );
      }
      // ID numérico sin match en flota (API vacía / fail-open): igual no avanzar a pedir km.
      if (bareNumeric && (!fleetCheckEarly.checked || !fleetCheckEarly.found)) {
        const fallbackTemplate =
          `No reconozco "${patente}" como patente ni como nombre de unidad. ` +
          `Pasame la matrícula (ej. AB 006 EX) o el código interno (ej. M300-097), o escribí "listado de mis unidades".`;
        const message = await composeOdometerDialogueReply({
          situation: "error_not_found",
          history: flowThreadText,
          lastCustomerMessage: rawText,
          fieldHint: wantsHorometro ? "horometro" : "odometro",
          fallbackTemplate,
        });
        await appendOutboundBotMessage(rawPhone, message, {
          source: "wara_odometro_response",
          stage: "suspicious_numeric_unit",
          patente,
        });
        return NextResponse.json(
          { ok: false, ok_s: "false", error: "Unidad no identificada", message },
          { status: BB_STATUS },
        );
      }
      if (!isPlausibleVehiclePlate(patente) && !bareNumeric && !fleetCheckEarly.found) {
        const fleetResolved = await resolvePatenteFromFleetForMeterTramite({
          rawPhone,
          rawText,
          flowThreadText,
          explicitUnitNameInMessage,
        });
        if (fleetResolved.kind === "clarification") return fleetResolved.response;
        if (fleetResolved.kind === "resolved") patente = fleetResolved.patente;
      }
    }
    if (patente) {
      await setActiveUnit(prisma, rawPhone, patente, { source: "odometro" });
      if (isConversationNotebookEnabled()) {
        await patchSessionNotebook(
          prisma,
          rawPhone,
          {
            intent: meterType,
            unitFocus: { plate: patente, updatedAt: new Date().toISOString() },
            tramite: { type: meterType, plate: patente },
            awaiting: wantsHorometro ? "horometro_value" : "odometro_value",
          },
          { syncActiveUnit: true, activeUnitSource: "odometro" },
        );
      }
    }
    // horometerFlowActive ya contempla horometerOnlyIntent, el estado del hilo (acotado
    // y con prioridad a una mención explícita del campo en el mensaje actual) — no se
    // repite acá el chequeo suelto sobre flowThreadText (esa era la fuente del bug real
    // de producción 2026-07-29 documentado más arriba).
    const plateDisplay = formatFleetUnitLabel(formatPlateWithSpaces(patente) ?? patente);
    const earlyFechaNaive = parseFechaFromText(rawText, "America/Argentina/Buenos_Aires");
    const earlyFechaDisplay = earlyFechaNaive
      ? formatFechaDisplay(fechaWara(earlyFechaNaive, "America/Argentina/Buenos_Aires"))
      : null;
    const fallbackTemplate = patente
      ? wantsHorometro
        ? earlyFechaDisplay
          ? formatMeterAsk({
              meter: "hourmeter",
              unitLabel: plateDisplay,
              expected: "value",
            })
          : formatMeterAskWithReading({ meter: "hourmeter", unitLabel: plateDisplay })
        : formatMeterAskWithReading({ meter: "odometer", unitLabel: plateDisplay })
      : formatMeterAskWithReading({ meter: "odometer", unitLabel: "la unidad" });
    const message = patente
      ? await composeOdometerDialogueReply({
          situation: "missing_value",
          history: flowThreadText,
          lastCustomerMessage: rawText,
          requiredTokens: [plateDisplay, ...(earlyFechaDisplay ? [earlyFechaDisplay] : [])],
          fieldHint: wantsHorometro ? "horometro" : "odometro",
          fallbackTemplate,
        })
      : fallbackTemplate;
    await setPendingAction(prisma, rawPhone, "odometro", {
      summary: message,
      payload: {
        patente,
        odometro: typeof odometro === "number" ? odometro : undefined,
        horometro: typeof horometro === "number" ? horometro : undefined,
        fecha: earlyFechaNaive ?? undefined,
        meterType,
      },
    });
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: earlyFechaDisplay ? "horometro_awaiting_hours" : "missing_value_fecha_hora",
    });
    return NextResponse.json({ ok: false, error: "Falta odómetro u horómetro", message }, { status: BB_STATUS });
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

  const activeCompany = session.companyName?.trim() || "tu empresa";
  // Bug real 2026-08-06: no registrar IDs numéricos inventados (2408437 → 2504878).
  if (looksLikeBareNumericUnitId(patente) && !isPlausibleVehiclePlate(patente)) {
    const message =
      `No reconozco "${patente}" como patente ni como nombre de unidad. ` +
      `Pasame la matrícula (ej. AB 006 EX) o el código interno (ej. M300-097), o escribí "listado de mis unidades".`;
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: "suspicious_numeric_unit",
      patente,
    });
    return NextResponse.json(
      { ok: false, ok_s: "false", error: "Unidad no identificada", message },
      { status: BB_STATUS },
    );
  }
  const fleetCheck = await validatePlateInFleetForPhone(
    prisma,
    rawPhone,
    patente,
    activeCompany,
    "odometer",
  );
  if (!fleetCheck.found && fleetCheck.checked && fleetCheck.message) {
    await appendOutboundBotMessage(rawPhone, fleetCheck.message, {
      source: "wara_odometro_response",
      ok: false,
      patente,
      companyName: activeCompany,
      stage: "plate_not_in_fleet",
    });
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        error: "Patente no encontrada en flota",
        message: fleetCheck.message,
        patente,
        companyName: activeCompany,
      },
      { status: BB_STATUS },
    );
  }

  await setActiveUnit(prisma, rawPhone, patente, { source: "odometro" });
  if (isConversationNotebookEnabled()) {
    const meterType = resolveMeterNotebookType({ horometerFlowActive, horometerOnlyIntent });
    await patchSessionNotebook(
      prisma,
      rawPhone,
      {
        intent: meterType,
        unitFocus: { plate: patente, updatedAt: new Date().toISOString() },
        tramite: {
          type: meterType,
          plate: patente,
          ...(typeof odometro === "number" && Number.isFinite(odometro) ? { odometro } : {}),
          ...(typeof horometro === "number" && Number.isFinite(horometro) ? { horometro } : {}),
        },
      },
      { syncActiveUnit: true, activeUnitSource: "odometro" },
    );
  }

  const customerTz =
    session.lookup?.customerTimezone || session.lookup?.userTimezone || "America/Argentina/Buenos_Aires";
  // Bug real, producción 2026-07-23: el cliente dio fecha y hora del cambio ("Hora:
  // 10:35 / Fecha 21/07/26") pero el resumen de confirmación nunca las mostraba —
  // solo patente y odómetro. El cliente no tenía forma de verificar ANTES de
  // confirmar qué fecha/hora se iba a registrar, y terminó preguntando después "¿se
  // registró como te la pedí?" sin que el bot pudiera contestarle con ese dato. Se
  // calcula la fecha ACÁ (antes del resumen) y se muestra siempre que el cliente haya
  // dado una explícita (no la de "ahora", para no confundir con un dato que no pidió).
  const fechaFromMessage = parseFechaFromText(rawText, customerTz);
  const clientExplicitFechaThisTurn =
    !!fechaFromMessage ||
    !!parsed.data.fecha ||
    !!parsed.data.date ||
    looksLikeOdometerPendingDataAmendment(rawText) ||
    /\b(fecha|hora|ayer|hoy|anteayer|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i.test(rawText);
  const odometerScopedThread = (() => {
    const lines = flowThreadText.split(/\n/).filter(Boolean);
    let start = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (
        looksLikeOdometerIntentStart(lines[i] ?? "") ||
        /\bperfecto,?\s+tomo\b/i.test(lines[i] ?? "")
      ) {
        start = i;
        break;
      }
    }
    return lines.slice(start).join("\n");
  })();
  const fechaFromScopedThread = nonDataCustomerTurn
    ? undefined
    : parseFechaFromText(odometerScopedThread, customerTz);
  let fechaExplicita =
    parsed.data.fecha ??
    parsed.data.date ??
    fechaFromMessage ??
    (amendsPendingOdoConfirm
      ? pendingPayloadFecha
      : clientExplicitFechaThisTurn && !nonDataCustomerTurn
        ? mergedFields.fechaNaive
        : undefined) ??
    (amendsPendingOdoConfirm || nonDataCustomerTurn ? undefined : fechaFromScopedThread);
  // Si ya había día sin hora en pending y ahora mandan solo "14:30", no pisar con "hoy".
  {
    const baseDate =
      pendingPayloadFecha ??
      (fechaExplicita && !fechaLecturaTieneHora(fechaExplicita, rawText) ? fechaExplicita : undefined) ??
      (fechaFromScopedThread && !fechaLecturaTieneHora(fechaFromScopedThread, odometerScopedThread)
        ? fechaFromScopedThread
        : undefined);
    const merged = mergeFechaConHoraSuelt(baseDate, rawText, customerTz);
    if (merged) fechaExplicita = merged;
  }
  // Pedido Emma/Wara 2026-08-06: «ahora» = lectura en este momento (fecha+hora actuales).
  if (!fechaExplicita && looksLikeAhoraComoFechaLectura(rawText)) {
    fechaExplicita = fechaWara(undefined, customerTz);
  }
  // «ahora» con día previo pendiente: usar día de hoy + hora actual (lectura recién).
  if (fechaExplicita && !fechaLecturaTieneHora(fechaExplicita, rawText) && looksLikeAhoraComoFechaLectura(rawText)) {
    fechaExplicita = fechaWara(undefined, customerTz);
  }
  let fecha = fechaWara(fechaExplicita, customerTz);
  let fechaDisplay = fechaExplicita ? formatFechaDisplay(fecha) : null;
  const fechaHoraSourceText = [rawText, odometerScopedThread, pendingPayloadFecha ?? ""].join("\n");
  const hasFechaHoraLectura = fechaLecturaTieneHora(fechaExplicita, fechaHoraSourceText);

  // Mejora pedida por el cliente (producción 2026-07-23): "¿cómo contempla el caso de
  // que alguien pida el cambio de odómetro para un día POSTERIOR a la fecha en la que
  // lo solicita?" — un odómetro no puede ser de un momento que todavía no pasó. Solo
  // se valida cuando el cliente dio una fecha explícita (nunca la de "ahora", que por
  // definición no puede ser futura).
  if (fechaExplicita && isFechaEnFuturo(fecha, customerTz)) {
    const message =
      `La fecha que me pasaste (${fechaDisplay}) es posterior a la fecha y hora actuales. ` +
      `¿Podés confirmarme la fecha y hora correctas del cambio de odómetro?`;
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: "fecha_futura",
    });
    return NextResponse.json(
      { ok: false, ok_s: "false", error: "Fecha futura", message },
      { status: BB_STATUS },
    );
  }

  const confirmSignal = parsed.data.confirm ?? parsed.data.confirmation ?? rawText;
  const hasCompleteOdoPayload =
    !!patente &&
    ((typeof odometro === "number" && Number.isFinite(odometro)) ||
      (typeof horometro === "number" && Number.isFinite(horometro)));
  const confirmed =
    isConfirmed(confirmSignal) ||
    confirmWithSupplement ||
    (effectivePendingOdoConfirm && isConfirmed(rawText)) ||
    (isConfirmed(rawText) && hasCompleteOdoPayload);

  if (confirmed) {
    const pendingConfirm = await getPendingAction(prisma, rawPhone);
    const payload = pendingConfirm?.type === "odometro" ? pendingConfirm.payload : undefined;
    const summaryOdometro = extractOdometroFromOdometerSummary(flowThreadText);
    const summaryHorometro = extractHorometroFromOdometerSummary(flowThreadText);
    if (payload) {
      if (payload.patente) patente = normalizePlate(String(payload.patente));
      if (typeof summaryHorometro === "number" && Number.isFinite(summaryHorometro)) {
        horometro = summaryHorometro;
      } else if (typeof payload.horometro === "number" && Number.isFinite(payload.horometro)) {
        horometro = payload.horometro as number;
      }
      // Preferir km del mensaje actual / payload sobre el resumen del bot (puede
      // arrastrar km fantasma). Bug 2026-08-07: 8900 del cliente vs 10500 del bot.
      if (typeof kmFromCurrentMessage === "number") {
        odometro = kmFromCurrentMessage;
      } else if (typeof payload.odometro === "number" && Number.isFinite(payload.odometro)) {
        odometro = payload.odometro as number;
      } else if (typeof summaryOdometro === "number" && Number.isFinite(summaryOdometro)) {
        odometro = summaryOdometro;
      }
      if (typeof payload.fecha === "string" && payload.fecha.trim()) {
        fechaExplicita = payload.fecha.trim();
        fecha = fechaWara(fechaExplicita, customerTz);
        fechaDisplay = formatFechaDisplay(fecha);
      }
    } else if (effectivePendingOdoConfirm || hasPendingOdometerConfirmation(flowThreadText)) {
      const summaryPlate =
        extractPlateFromOdometerSummary(flowThreadText) ??
        extractLastPlateFromThread(flowThreadText);
      if (summaryPlate) patente = normalizePlate(summaryPlate);
      if (typeof summaryHorometro === "number" && Number.isFinite(summaryHorometro)) {
        horometro = summaryHorometro;
      }
      if (typeof kmFromCurrentMessage === "number") {
        odometro = kmFromCurrentMessage;
      } else {
        const contextOdometro = extractOdometroFromOdometerContext(flowThreadText);
        if (typeof contextOdometro === "number" && Number.isFinite(contextOdometro)) {
          odometro = contextOdometro;
        } else if (typeof summaryOdometro === "number" && Number.isFinite(summaryOdometro)) {
          odometro = summaryOdometro;
        }
      }
      const scopedFecha = parseFechaFromText(odometerScopedThread, customerTz);
      if (scopedFecha) {
        fechaExplicita = scopedFecha;
        fecha = fechaWara(fechaExplicita, customerTz);
        fechaDisplay = formatFechaDisplay(fecha);
      }
    }
    if (clientExplicitFechaThisTurn && fechaFromMessage) {
      fechaExplicita = fechaFromMessage;
      fecha = fechaWara(fechaExplicita, customerTz);
      fechaDisplay = formatFechaDisplay(fecha);
    }
    if (!fechaExplicita && looksLikeAhoraComoFechaLectura(rawText)) {
      fechaExplicita = fechaWara(undefined, customerTz);
      fecha = fechaExplicita;
      fechaDisplay = formatFechaDisplay(fecha);
    }
    // No registrar CONFIRMO sin fecha+hora de lectura (pedido Emma 2026-08-06).
    if (!fechaLecturaTieneHora(fechaExplicita, [rawText, odometerScopedThread].join("\n"))) {
      const plateDisp = formatPlateWithSpaces(patente) ?? patente ?? "la unidad";
      const valueHint =
        typeof odometro === "number"
          ? ` (${odometro} km)`
          : typeof horometro === "number"
            ? ` (${horometro} h)`
            : "";
      const fallbackTemplate =
        `Para ${plateDisp}${valueHint} me falta la fecha y hora de la lectura. ` +
        `Pasame ambas (ej. 05/08/26 a las 14:30).`;
      const message = await composeOdometerDialogueReply({
        situation: "missing_fecha_hora",
        history: flowThreadText,
        lastCustomerMessage: rawText,
        fieldHint: horometerFlowActive || horometerOnlyIntent ? "horometro" : "odometro",
        fallbackTemplate,
      });
      await setPendingAction(prisma, rawPhone, "odometro", {
        summary: message,
        payload: {
          patente,
          odometro,
          horometro,
          fecha: fechaExplicita ?? undefined,
          meterType: resolveMeterNotebookType({ horometerFlowActive, horometerOnlyIntent }),
        },
      });
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_fecha_hora_before_register",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Fecha y hora de lectura requeridas", message },
        { status: BB_STATUS },
      );
    }
  }

  if (!confirmed) {
    if (effectivePendingOdoConfirm && looksLikeOdometerConfirmationRejection(rawText)) {
      await clearPendingAction(prisma, rawPhone);
      if (isConversationNotebookEnabled()) {
        await clearSessionNotebook(prisma, rawPhone);
      }
      const message =
        "Entendido, no registro ese cambio. ¿Qué necesitás? Podés pedirme otro trámite (odómetro, horómetro, certificado, estado de unidad, etc.).";
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "confirmation_rejected",
      });
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          message,
          topicChange_s: "true",
          cancelled_s: "true",
        },
        { status: BB_STATUS },
      );
    }
    // Bug real, producción 2026-07-28: "corregir datos" (sin decir todavía cuál dato ni
    // el valor nuevo) caía en el recordatorio genérico de CONFIRMO como si no hubiera
    // dicho nada — el cliente no sentía que el bot entendió el pedido de corrección.
    if (
      effectivePendingOdoConfirm &&
      !fromText.patente &&
      typeof odometro !== "number" &&
      typeof horometro !== "number" &&
      looksLikeGenericCorrectionIntent(rawText)
    ) {
      const fallbackTemplate =
        "Decime qué dato querés corregir: la patente correcta, el odómetro (en km) o el horómetro (en hs), con el valor correcto, y actualizo el registro antes de pedirte el CONFIRMO.";
      const message = await composeOdometerDialogueReply({
        situation: "correction_prompt",
        history: flowThreadText,
        lastCustomerMessage: rawText,
        requireConfirmoWord: true,
        fallbackTemplate,
      });
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "correction_intent_no_value",
      });
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          message,
        },
        { status: BB_STATUS },
      );
    }
    // Pedido Emma/Wara 2026-08-06: km/hs + fecha + hora son obligatorios.
    // No mostrar CONFIRMO ni registrar con "ahora" en silencio.
    if (hasCompleteOdoPayload && !hasFechaHoraLectura) {
      const plateDisp = formatPlateWithSpaces(patente) ?? patente ?? "la unidad";
      // Solo mostrar km si vinieron del cliente (no del "Tomé … (10500 km)" del bot).
      const showKmHint =
        !horometerFlowActive &&
        !horometerOnlyIntent &&
        typeof odometro === "number" &&
        (typeof kmFromCurrentMessage === "number" ||
          explicitKmInMessage ||
          typeof bareKmInMessage === "number" ||
          typeof bareNumericAmendmentValue === "number" ||
          (typeof dbPendingOdoAction?.payload?.odometro === "number" &&
            dbPendingOdoAction.payload.odometro === odometro));
      const valueHint = showKmHint
        ? ` (${odometro} km)`
        : typeof horometro === "number"
          ? ` (${horometro} h)`
          : "";
      const odometroForPending = showKmHint ? odometro : undefined;
      const meterType = resolveMeterNotebookType({ horometerFlowActive, horometerOnlyIntent });
      const onlyDateNoTime =
        !!fechaExplicita && !fechaLecturaTieneHora(fechaExplicita, fechaHoraSourceText);
      // OJO: si dijo "ayer"/"lunes", mostrar DD/MM/AAAA concreto (sin 00:00 engañoso).
      const fechaDiaDisplay = fechaDisplay?.includes(" ")
        ? fechaDisplay.split(" ")[0]
        : fechaDisplay;
      const fallbackTemplate = onlyDateNoTime
        ? `Tomé el día ${fechaDiaDisplay} para ${plateDisp}${valueHint}. ¿A qué hora fue la lectura? (ej. 14:30).`
        : valueHint
          ? `Tomé ${plateDisp}${valueHint}. Me falta la fecha y hora de la lectura: pasamelas (ej. 05/08/26 a las 14:30).`
          : `Tomé ${plateDisp}. Pasame el odómetro en km y la fecha y hora de la lectura (ej. 8900 el 05/08/26 a las 14:30).`;
      const message = await composeOdometerDialogueReply({
        situation: "missing_fecha_hora",
        history: flowThreadText,
        lastCustomerMessage: rawText,
        fieldHint: horometerFlowActive || horometerOnlyIntent ? "horometro" : "odometro",
        fallbackTemplate,
      });
      await setPendingAction(prisma, rawPhone, "odometro", {
        summary: message,
        payload: {
          patente,
          odometro: odometroForPending,
          horometro,
          fecha: fechaExplicita ?? undefined,
          meterType,
        },
      });
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_fecha_hora",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Fecha y hora de lectura requeridas", message },
        { status: BB_STATUS },
      );
    }
    if (effectivePendingOdoConfirm && hasPendingOdometerConfirmation(flowThreadText)) {
      const remindMessage =
        "Para registrar el cambio respondé CONFIRMO. Si algo no está bien, decime la patente o el valor correcto, o escribí que querés hacer otra gestión.";
      await appendOutboundBotMessage(rawPhone, remindMessage, {
        source: "wara_odometro_response",
        stage: "confirmation_reminder",
      });
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          message: remindMessage,
        },
        { status: BB_STATUS },
      );
    }
    if (
      !patente &&
      ((typeof horometro === "number" && Number.isFinite(horometro)) ||
        (typeof odometro === "number" && Number.isFinite(odometro)))
    ) {
      const fleetResolved = await resolvePatenteFromFleetForMeterTramite({
        rawPhone,
        rawText,
        flowThreadText,
        explicitUnitNameInMessage,
      });
      if (fleetResolved.kind === "clarification") return fleetResolved.response;
      if (fleetResolved.kind === "resolved") patente = fleetResolved.patente;
    }
    if (!patente) {
      const fallbackTemplate =
        "Para registrar el cambio necesito identificar la unidad. Decime la patente (ej. AG 562 SP), un prefijo (ej. AG), la marca o el nombre interno, o escribí «listado de mis unidades».";
      const message = await composeOdometerDialogueReply({
        situation: "missing_plate",
        history: flowThreadText,
        lastCustomerMessage: rawText,
        fieldHint: horometerFlowActive || horometerOnlyIntent ? "horometro" : "odometro",
        fallbackTemplate,
      });
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_plate_before_confirm",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Patente requerida", message },
        { status: BB_STATUS },
      );
    }
    const plateDisplay = formatFleetUnitLabel(formatPlateWithSpaces(patente) ?? patente);
    const wantsHorometroConfirm = horometerFlowActive || horometerOnlyIntent;
    const meterValue = wantsHorometroConfirm ? horometro : odometro;
    const { dateDisp, time } = splitFechaDisplayParts(fechaDisplay);
    const confirmMessage =
      typeof meterValue === "number" && fechaDisplay && hasFechaHoraLectura
        ? formatMeterConfirm({
            meter: wantsHorometroConfirm ? "hourmeter" : "odometer",
            unitLabel: plateDisplay,
            value: meterValue,
            dateDisp,
            time,
          })
        : `Voy a registrar:\n• Patente: ${plateDisplay}\n\n` +
          `Si está correcto, respondé CONFIRMO para registrarlo en Wara.\n➡️ Respondé *CONFIRMO* o *CANCELAR*.`;
    if (!fechaDisplay || !hasFechaHoraLectura) {
      const fallbackTemplate =
        `Me falta la fecha y hora de la lectura. Pasame ambas (ej. 05/08/26 a las 14:30).`;
      const message = await composeOdometerDialogueReply({
        situation: "missing_fecha_hora",
        history: flowThreadText,
        lastCustomerMessage: rawText,
        fieldHint: horometerFlowActive || horometerOnlyIntent ? "horometro" : "odometro",
        fallbackTemplate,
      });
      await setPendingAction(prisma, rawPhone, "odometro", {
        summary: message,
        payload: { patente, odometro, horometro, fecha: fechaExplicita ?? undefined },
      });
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_fecha_hora_before_summary",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Fecha y hora de lectura requeridas", message },
        { status: BB_STATUS },
      );
    }
    // El resumen que se guarda en pendingAction (payload/summary) es siempre la plantilla
    // determinística — la humanización es solo cosmética para lo que ve el cliente, y no
    // debe afectar cómo se interpreta una confirmación/corrección posterior.
    await setPendingAction(prisma, rawPhone, "odometro", {
      summary: confirmMessage,
      payload: {
        patente,
        odometro,
        horometro,
        fecha: fechaExplicita ?? undefined,
        meterType: resolveMeterNotebookType({ horometerFlowActive, horometerOnlyIntent }),
      },
    });
    if (isConversationNotebookEnabled() && patente) {
      const meterType = resolveMeterNotebookType({ horometerFlowActive, horometerOnlyIntent });
      const plateNorm = normalizePlate(patente) ?? patente.replace(/\s+/g, "").toUpperCase();
      await patchSessionNotebook(
        prisma,
        rawPhone,
        {
          intent: meterType,
          awaiting: "confirm_registro",
          unitFocus: { plate: plateNorm, updatedAt: new Date().toISOString() },
          tramite: {
            type: meterType,
            plate: plateNorm,
            ...(typeof odometro === "number" && Number.isFinite(odometro) ? { odometro } : {}),
            ...(typeof horometro === "number" && Number.isFinite(horometro) ? { horometro } : {}),
            ...(fechaExplicita ? { fecha: fechaExplicita } : {}),
          },
        },
        { syncActiveUnit: true, activeUnitSource: "odometro" },
      );
    }
    // Nota: a diferencia de otros returns de este archivo, este bloque NO llamaba a
    // appendOutboundBotMessage antes de este cambio (BuilderBot envía `message` directo al
    // cliente por su cuenta en este paso) — se mantiene igual, solo se compone el texto.
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        confirmationRequired: true,
        confirmationRequired_s: "true",
        message: confirmMessage,
        patente,
        odometro,
        horometro,
      },
      { status: BB_STATUS },
    );
  }

  await clearPendingAction(prisma, rawPhone);
  if (isConversationNotebookEnabled()) {
    await clearSessionNotebook(prisma, rawPhone);
  }
  if (!fecha) {
    return NextResponse.json(
      { ok: false, error: "Fecha inválida", message: "La fecha indicada no es válida." },
      { status: BB_STATUS }
    );
  }
  if (!patente) {
    return NextResponse.json(
      { ok: false, error: "Patente requerida", message: "No pude identificar la patente para registrar." },
      { status: BB_STATUS },
    );
  }

  const fleetUnit = await findFleetUnitByPlate(session.sessionToken, patente);
  const patenteParaWara = resolveWaraPatenteForApi(patente, fleetUnit);

  const result = await registrarCambioOdometroHorometro(session.sessionToken, {
    patente: patenteParaWara,
    // Cliente habla en hora AR; la API Wara espera UTC (bug 2026-08-07: 09:43 → 06:43).
    fecha: fechaLocalNaiveToWaraUtc(fecha, customerTz),
    ...(typeof odometro === "number" && Number.isFinite(odometro) ? { odometro } : {}),
    ...(typeof horometro === "number" && Number.isFinite(horometro) ? { horometro } : {}),
  });

  let responseMessage = formatSuccessMessage(result, patente, fechaDisplay);
  // Si Wara no encontró la unidad y el cliente tiene más de una empresa, avisamos
  // en cuál estamos buscando y sugerimos cambiar de empresa (la patente puede ser de otra).
  if (!result.ok) {
    const companies = session.lookup?.contactos ?? [];
    const activeCompany = session.companyName?.trim();
    const notFound = /no se encontr|no encontr|veh[ií]culo|patente|unidad/i.test(result.error ?? "");
    if (fleetUnit && notFound) {
      const label =
        formatPlateWithSpaces(fleetUnit.patente || patente) ??
        fleetUnit.patente?.trim() ??
        fleetUnit.unidad?.trim() ??
        patente;
      responseMessage =
        `Encontré ${label} en tu flota de ${activeCompany || "Wara"}, pero Wara no aceptó registrar el odómetro. ` +
        `Puede ser una unidad de prueba o sin odómetro habilitado. Probá con otra patente del listado (ej. AB006EX) o escribí "hablar con un asesor".`;
    } else if (companies.length > 1 && notFound) {
      responseMessage =
        `${responseMessage}${activeCompany ? ` (busqué en ${activeCompany})` : ""}. ` +
        `Si la unidad es de otra de tus empresas, escribí "cambiar empresa" y la registro ahí.`;
    }
  }
  // Se humaniza DESPUÉS de armar responseMessage (con todos los datos ya resueltos) y ANTES
  // de guardarlo/devolverlo, para que el texto persistido en el hilo y el que recibe el
  // cliente sean siempre el mismo (evita el bug histórico de mismatch texto guardado vs. enviado).
  responseMessage = await humanizeBotReply(responseMessage, {
    context: result.ok
      ? "Confirmación de cambio de odómetro/horómetro registrado con éxito"
      : "Aviso de error al registrar el cambio de odómetro/horómetro",
  });
  await appendOutboundBotMessage(rawPhone, responseMessage, {
    source: "wara_odometro_response",
    ok: result.ok,
    patente,
    patenteRegistrada: patenteParaWara,
    companyName: session.companyName ?? "",
  });

  return NextResponse.json(
    {
      ...result,
      patente,
      patenteRegistrada: patenteParaWara,
      fecha,
      companyName: session.companyName ?? "",
      contactName: session.contactName ?? "",
      message: responseMessage,
    },
    { status: BB_STATUS }
  );
}
