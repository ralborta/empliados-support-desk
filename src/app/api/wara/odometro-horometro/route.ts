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
  detectPlate,
  extractLastPlateFromThread,
  extractPlateCorrectionHint,
  extractPlateFromOdometerSummary,
  extractPlateFromPerfectoTomo,
  extractOdometroFromOdometerSummary,
  extractHorometroFromOdometerSummary,
  formatPlateWithSpaces,
  resolveOdometerContextPlate,
  hasPendingOdometerConfirmation,
  isExamplePlate,
  isOdometerFlowSuperseded,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerFlowReminder,
  looksLikeOdometerHelpRequest,
  looksLikeOdometerIntentStart,
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
} from "@/lib/wara";
import {
  looksLikeFleetUnitSearchInput,
  looksLikeUnitNameInMessage,
  looksLikeVagueUnitReference,
  resolvePlateWithWaraFleet,
} from "@/lib/waraUnitIntent";
import { fechaWara, formatFechaDisplay, isFechaEnFuturo, parseFechaFromText } from "@/lib/odometroFecha";
import { resolveOdometerHorometerFields, looksLikeClockTimeOnlyReading, stripHorometroConfusedWithClockTime } from "@/lib/odometroHorometroExtract";
import { clearPendingAction, getPendingAction, setPendingAction } from "@/lib/pendingAction";
import { humanizeBotReply } from "@/lib/botReplyHumanizer";
import { composeOdometerDialogueReply } from "@/lib/odometerDialogueAI";
import { getActiveUnit, setActiveUnit, shouldUseActiveUnitFallback } from "@/lib/activeUnit";
import {
  looksLikeConversationAcknowledgement,
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
  const t = rawText.trim().replace(/\./g, "").replace(/\s+/g, "");
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
  const text = rawText || "";
  const patente = detectPlate(text) ?? undefined;
  const cleaned = patente
    ? text.replace(new RegExp(patente.replace(/(.)/g, "$1\\s?"), "gi"), " ")
    : text;
  const kmCandidates: string[] = [];
  const horoCandidates: string[] = [];
  const kmRegex = /(?:od[oó]metro|kilometraje|kil[oó]metros?|km)[^\d]{0,20}(\d[\d.\s,]*\d|\d)/gi;
  const kmTrailRegex = /(\d[\d.\s,]*\d|\d)\s*(?:km|kil[oó]metros?)\b/gi;
  // "Hora: 09:30" (hora de lectura) NO es horómetro; solo horómetro explícito o "horas" en plural.
  const horoRegex = /(?:hor[oó]metro|\bhoras\b)[^\d]{0,20}(\d[\d.\s,]*\d|\d)/gi;
  const horoTrailRegex = /(\d[\d.\s,]*\d|\d)\s*(?:hs|\bhoras\b)\b/gi;
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
  const freshOdometerRestart =
    odometerFlowStart &&
    !explicitVagueUnitReference &&
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
    !explicitVagueUnitReference &&
    !hasUnitHintInCurrentMessage &&
    !isOdometerReminder &&
    (horometerOnlyIntent ||
      supersedesPendingConfirm ||
      freshOdometerRestart ||
      priorFlowExplicitlySuperseded ||
      (!hasPendingConfirmInThread && !threadHasPriorOdometerUnitRequest));
  if (treatAsBlankFlowStart || supersedesPendingConfirm) {
    await clearPendingAction(prisma, rawPhone);
  }
  const fromText = parseFromText(rawText);
  const threadText = treatAsBlankFlowStart || supersedesPendingConfirm ? "" : preliminaryThreadText;
  const prefixInMessageEarly = extractPlatePrefixFromMessage(rawText);
  const explicitRejectionEarly = looksLikeUnitRejection(rawText);
  const plateCorrectionEarly = looksLikePlateCorrectionRequest(rawText);
  const correctingUnitDuringPendingConfirm =
    !treatAsBlankFlowStart &&
    !supersedesPendingConfirm &&
    hasLiveOdometerPendingAction &&
    (hasPendingOdometerConfirmation(threadText) || !!dbPendingOdoAction?.payload) &&
    (prefixInMessageEarly || explicitRejectionEarly || plateCorrectionEarly);
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
  const horometerFlowActive = rawExplicitlyMentionsOdometroOnly
    ? false
    : horometerOnlyIntent ||
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

  const activeUnitRecordEarly = skipThreadPlate ? null : await getActiveUnit(prisma, rawPhone);

  if (
    !odometerFlowStart &&
    (looksLikeOpcionesInfoRequest(rawText) ||
      looksLikeUnidadesInfoRequest(rawText) ||
      looksLikeConversationAcknowledgement(rawText) ||
      (looksLikeNonOdometerOperationalIntent(rawText) && !plateCorrection) ||
      isOdometerFlowSuperseded(threadText)) &&
    !shouldContinueOdometerFlow(rawText, threadText)
  ) {
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

  const historialForExtract = treatAsBlankFlowStart || supersedesPendingConfirm ? "" : flowThreadText;
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
    activeUnitPlate: activeUnitRecordEarly?.plate,
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
  const isFleetUnitSelection = looksLikeFleetUnitSearchInput(rawText);
  const prefixInMessage = extractPlatePrefixFromMessage(rawText);
  const plateInMessage = normalizePlate(fromText.patente ?? detectPlate(rawText) ?? "");
  let explicitMessagePlate = normalizePlate(parsed.data.patente ?? parsed.data.plate ?? plateInMessage ?? "");
  // Bug 2026-07-27: mergedFields/IA inferían OST223 del hilo y resolvePlateWithWaraFleet
  // los tomaba como directPlate — saltaba búsqueda por prefijo MYQ/RMX.
  if (!isFleetUnitSelection && !prefixInMessage && mergedFields.patente) {
    explicitMessagePlate = normalizePlate(explicitMessagePlate || mergedFields.patente);
  }
  const awaitingOdometerKm = threadAwaitingOdometerKmValue(flowThreadText);
  const awaitingHorometerKm = threadAwaitingHorometerKmValue(flowThreadText);
  const lockedPlateFromTomo =
    awaitingHorometerKm || awaitingOdometerKm
      ? extractPlateFromPerfectoTomo(flowThreadText)
      : undefined;
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
      { preferAi: true, odometerContext: true },
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
        activeUnitPlate: activeUnitRecord?.plate,
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
        activeUnitPlate: activeUnitRecord?.plate,
        explicitVagueUnitReference: true,
        hasPendingOdometerConfirm:
          hasPendingConfirmInThread && !correctingUnitDuringPendingConfirm,
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
    } else if (shouldUseActiveUnitFallback(rawText) && activeUnitRecord?.plate) {
      patente = activeUnitRecord.plate;
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
        threadAwaitingOdometerConfirmDetails(threadText);
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
  const allowThreadKm =
    explicitKmInMessage ||
    effectivePendingOdoConfirm ||
    awaitingOdometerKm ||
    (!isFleetUnitSelection && !awaitingPlateSelection);

  const bareKmInMessage = awaitingOdometerKm ? parseBareOdometerKm(rawText) : undefined;
  const bareHorometerInMessage = awaitingHorometerKm ? parseBareHorometerHours(rawText) : undefined;

  const rawOdometro = firstFiniteNumber(
    parsed.data.odometro,
    parsed.data.odometer,
    !horometerFlowActive && !horometerOnlyIntent ? bareNumericAmendmentValue : undefined,
    mergedFields.odometro,
    bareKmInMessage,
    fromText.odometro,
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
    (awaitingHorometerKm || horometerFlowActive) &&
    fechaFromMessageEarly &&
    !bareHorometerInMessage &&
    typeof fromText.horometro !== "number"
  ) {
    horometro = undefined;
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
      if (!patente && payload.patente) patente = normalizePlate(String(payload.patente));
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
    if (treatAsBlankFlowStart) {
      const fallbackTemplate = horometerOnlyIntent
        ? "Para registrar el cambio de horómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)"
        : "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)";
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
    const hintText = [rawText, flowThreadText].filter(Boolean).join("\n");
    const fleetPlate = await resolvePlateWithWaraFleet(prisma, rawPhone, hintText, flowThreadText);
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
    } else if (shouldUseActiveUnitFallback(hintText) && activeUnitRecord?.plate) {
      patente = activeUnitRecord.plate;
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
  if (!(typeof odometro === "number" && Number.isFinite(odometro)) && !(typeof horometro === "number" && Number.isFinite(horometro))) {
    // Bug real, producción 2026-07-28: la "unidad activa" (usada como respaldo por
    // OTROS trámites cuando no hay patente explícita) solo se actualizaba al completar
    // el registro con éxito. Si el trámite quedaba a medias en este paso intermedio
    // (pidiendo las horas/km), activeUnit seguía apuntando a una consulta vieja de
    // OTRO trámite (ej. una consulta de GPS de varios minutos antes) — y ese valor
    // desactualizado terminaba filtrándose en un resumen posterior. Se actualiza acá
    // también, apenas se confirma la patente, no solo al final.
    if (patente) {
      await setActiveUnit(prisma, rawPhone, patente, { source: "odometro" });
    }
    // horometerFlowActive ya contempla horometerOnlyIntent, el estado del hilo (acotado
    // y con prioridad a una mención explícita del campo en el mensaje actual) — no se
    // repite acá el chequeo suelto sobre flowThreadText (esa era la fuente del bug real
    // de producción 2026-07-29 documentado más arriba).
    const wantsHorometro = horometerFlowActive;
    const plateDisplay = formatPlateWithSpaces(patente) ?? patente;
    const earlyFechaNaive = parseFechaFromText(rawText, "America/Argentina/Buenos_Aires");
    const earlyFechaDisplay = earlyFechaNaive
      ? formatFechaDisplay(fechaWara(earlyFechaNaive, "America/Argentina/Buenos_Aires"))
      : null;
    const fallbackTemplate = patente
      ? wantsHorometro
        ? earlyFechaDisplay
          ? `Tomé la fecha ${earlyFechaDisplay}. ¿Cuántas horas de motor tiene ${plateDisplay} ahora?`
          : `Perfecto, tomo ${plateDisplay}. ¿Cuál es el nuevo horómetro en horas?`
        : `Perfecto, tomo ${plateDisplay}. ¿Cuál es el nuevo odómetro en km?`
      : "¿Cuál es el nuevo valor de odómetro (en km) o de horómetro (en horas)?";
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
    await appendOutboundBotMessage(rawPhone, message, {
      source: "wara_odometro_response",
      stage: earlyFechaDisplay ? "horometro_awaiting_hours" : "missing_value",
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
  const fechaFromScopedThread = parseFechaFromText(odometerScopedThread, customerTz);
  let fechaExplicita =
    parsed.data.fecha ??
    parsed.data.date ??
    fechaFromMessage ??
    (amendsPendingOdoConfirm
      ? pendingPayloadFecha
      : clientExplicitFechaThisTurn
        ? mergedFields.fechaNaive
        : undefined) ??
    (amendsPendingOdoConfirm ? undefined : fechaFromScopedThread);
  let fecha = fechaWara(fechaExplicita, customerTz);
  let fechaDisplay = fechaExplicita ? formatFechaDisplay(fecha) : null;

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
      if (typeof summaryOdometro === "number" && Number.isFinite(summaryOdometro)) {
        odometro = summaryOdometro;
      } else if (typeof payload.odometro === "number" && Number.isFinite(payload.odometro)) {
        odometro = payload.odometro as number;
      }
      if (typeof payload.fecha === "string" && payload.fecha.trim()) {
        fechaExplicita = payload.fecha.trim();
        fecha = fechaWara(fechaExplicita, customerTz);
        fechaDisplay = formatFechaDisplay(fecha);
      }
    } else if (effectivePendingOdoConfirm) {
      const summaryPlate = extractPlateFromOdometerSummary(flowThreadText);
      if (summaryPlate) patente = normalizePlate(summaryPlate);
      if (typeof summaryHorometro === "number" && Number.isFinite(summaryHorometro)) {
        horometro = summaryHorometro;
      }
      if (typeof summaryOdometro === "number" && Number.isFinite(summaryOdometro)) {
        odometro = summaryOdometro;
      }
    }
    if (clientExplicitFechaThisTurn && fechaFromMessage) {
      fechaExplicita = fechaFromMessage;
      fecha = fechaWara(fechaExplicita, customerTz);
      fechaDisplay = formatFechaDisplay(fecha);
    }
  }

  if (!confirmed) {
    if (effectivePendingOdoConfirm && looksLikeOdometerConfirmationRejection(rawText)) {
      await clearPendingAction(prisma, rawPhone);
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
    if (effectivePendingOdoConfirm) {
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
    const plateDisplay = formatPlateWithSpaces(patente) ?? patente;
    const odoLine =
      !horometerFlowActive &&
      !horometerOnlyIntent &&
      typeof odometro === "number"
        ? `• Odómetro: ${odometro} km`
        : typeof horometro === "number"
          ? `• Horómetro: ${horometro} h`
          : "";
    const fechaLine = fechaDisplay ? `\n• Fecha: ${fechaDisplay}` : "";
    const confirmMessage =
      `Voy a registrar:\n• Patente: ${plateDisplay}\n${odoLine}${fechaLine}\n\n` +
      `Si está correcto, respondé CONFIRMO para registrarlo en Wara.`;
    // El resumen que se guarda en pendingAction (payload/summary) es siempre la plantilla
    // determinística — la humanización es solo cosmética para lo que ve el cliente, y no
    // debe afectar cómo se interpreta una confirmación/corrección posterior.
    await setPendingAction(prisma, rawPhone, "odometro", {
      summary: confirmMessage,
      payload: { patente, odometro, horometro, fecha: fechaExplicita ?? undefined },
    });
    // Nota: a diferencia de otros returns de este archivo, este bloque NO llamaba a
    // appendOutboundBotMessage antes de este cambio (BuilderBot envía `message` directo al
    // cliente por su cuenta en este paso) — se mantiene igual, solo se compone el texto.
    const confirmRequiredTokens = [
      ...(plateDisplay ? [plateDisplay] : []),
      ...(typeof odometro === "number" && !horometerFlowActive && !horometerOnlyIntent
        ? [String(odometro)]
        : []),
      ...(typeof horometro === "number" && (horometerFlowActive || horometerOnlyIntent)
        ? [String(horometro)]
        : []),
      ...(fechaDisplay ? [fechaDisplay] : []),
    ];
    const humanizedConfirmMessage = await composeOdometerDialogueReply({
      situation: "confirmation_summary",
      history: flowThreadText,
      lastCustomerMessage: rawText,
      requiredTokens: confirmRequiredTokens,
      requireConfirmoWord: true,
      fieldHint: horometerFlowActive || horometerOnlyIntent ? "horometro" : "odometro",
      fallbackTemplate: confirmMessage,
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        flowComplete_s: "true",
        confirmationRequired: true,
        confirmationRequired_s: "true",
        message: humanizedConfirmMessage,
        patente,
        odometro,
        horometro,
      },
      { status: BB_STATUS },
    );
  }

  await clearPendingAction(prisma, rawPhone);
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
    fecha,
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
