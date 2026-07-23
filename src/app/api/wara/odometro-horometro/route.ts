import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
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
  formatPlateWithSpaces,
  hasPendingOdometerConfirmation,
  isExamplePlate,
  isOdometerFlowSuperseded,
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeOdometerFlowReminder,
  looksLikeOdometerHelpRequest,
  looksLikeOdometerIntentStart,
  looksLikeUnitRejection,
  normalizePlate,
  resolveWaraPatenteForApi,
  threadHasActiveOdometerFlow,
} from "@/lib/wara";
import {
  looksLikeFleetUnitSearchInput,
  looksLikeUnitNameInMessage,
  looksLikeVagueUnitReference,
  resolvePlateWithWaraFleet,
} from "@/lib/waraUnitIntent";
import { fechaWara, formatFechaDisplay, isFechaEnFuturo, parseFechaFromText } from "@/lib/odometroFecha";
import { clearPendingAction, setPendingAction } from "@/lib/pendingAction";
import { getActiveUnit, setActiveUnit, shouldUseActiveUnitFallback } from "@/lib/activeUnit";
import {
  looksLikeConversationAcknowledgement,
  looksLikeNonOdometerOperationalIntent,
  looksLikeOpcionesInfoRequest,
  looksLikePlateCorrectionRequest,
  looksLikeUnidadesInfoRequest,
  looksLikeVehicleBrandOrUnitSearch,
  shouldContinueOdometerFlow,
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
    return msgs
      .reverse()
      .map((m) => m.text)
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * Extrae la patente del resumen confirmado ("Voy a registrar:\n• Patente: AD 427 MC").
 * Es la fuente más confiable: es el dato que el bot armó y el cliente confirmó.
 * Ignora patentes de ejemplo. Toma la última ocurrencia (el resumen más reciente).
 */
function plateFromSummary(text: string): string | undefined {
  const matches = [
    ...(text || "").matchAll(
      /patente[^\n:]*[:\-]\s*([A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})/gi
    ),
  ];
  for (let i = matches.length - 1; i >= 0; i--) {
    const plate = normalizePlate(matches[i][1]);
    if (plate && !isExamplePlate(plate)) return plate;
  }
  return undefined;
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
  const rawText = (
    parsed.data.rawText ??
    parsed.data.body ??
    parsed.data.message ??
    ""
  ).trim();
  const odometerIntentStart = looksLikeOdometerIntentStart(rawText);
  const odometerHelpStart = looksLikeOdometerHelpRequest(rawText);
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
  const preliminaryThreadText = odometerFlowStart ? await recentThreadText(rawPhone) : "";
  const hasPendingConfirmInThread = hasPendingOdometerConfirmation(preliminaryThreadText);
  const hasUnitHintInCurrentMessage =
    looksLikeFleetUnitSearchInput(rawText) || looksLikeUnitNameInMessage(rawText);
  const isOdometerReminder = looksLikeOdometerFlowReminder(rawText);
  const threadHasPriorOdometerUnitRequest = preliminaryThreadText
    .split("\n")
    .some(
      (line) =>
        looksLikeExplicitOdometerUpdateRequest(line) &&
        (looksLikeFleetUnitSearchInput(line) || looksLikeUnitNameInMessage(line)),
    );
  const treatAsBlankFlowStart =
    odometerFlowStart &&
    !explicitVagueUnitReference &&
    !hasPendingConfirmInThread &&
    !hasUnitHintInCurrentMessage &&
    !isOdometerReminder &&
    !threadHasPriorOdometerUnitRequest;
  const fromText = parseFromText(rawText);
  const threadText = treatAsBlankFlowStart
    ? ""
    : odometerFlowStart
      ? preliminaryThreadText
      : await recentThreadText(rawPhone);
  const activeOdoFlow = threadHasActiveOdometerFlow(threadText);
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
    explicitRejection ||
    (activeOdoFlow && (plateCorrection || unitHintInMessage));

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

  const threadParsed = parseFromText(threadText);
  // detectPlate(threadText) devuelve la PRIMERA patente que aparece en todo el hilo
  // (los últimos 24 mensajes), no la más reciente. Bug real, producción 2026-07-23:
  // el cliente pidió cambiar el odómetro de "la nissan", el bot resolvió y confirmó
  // "tomo AG 562 SP", pero al mandar el km nuevo el registro se intentó contra "OST
  // 223" (una patente mencionada antes en la misma conversación por otro trámite).
  // extractLastPlateFromThread recorre el hilo de más reciente a más antiguo.
  const lastThreadPlate = extractLastPlateFromThread(threadText);

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
  const activeUnitRecord = skipThreadPlate ? null : await getActiveUnit(prisma, rawPhone);
  let patente = normalizePlate(
    parsed.data.patente ??
      parsed.data.plate ??
      fromText.patente ??
      (skipThreadPlate ? "" : plateFromSummary(threadText)) ??
      (skipThreadPlate ? "" : lastThreadPlate) ??
      (skipThreadPlate ? "" : activeUnitRecord?.plate) ??
      ""
  );

  if (!patente && !odometerFlowStart) {
    const fleetPlate = await resolvePlateWithWaraFleet(
      prisma,
      rawPhone,
      rawText,
      threadText
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
  } else if (skipThreadPlate && !patente && activeOdoFlow) {
    const fleetPlate = await resolvePlateWithWaraFleet(prisma, rawPhone, rawText, threadText);
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
  const odometro = firstFiniteNumber(
    parsed.data.odometro,
    parsed.data.odometer,
    fromText.odometro,
    treatAsBlankFlowStart ? undefined : threadParsed.odometro
  );
  const combinedText = [threadText, rawText].filter(Boolean).join("\n");
  const horometro = resolveHorometroForWara({
    explicitHorometro: firstFiniteNumber(parsed.data.horometro, parsed.data.hourmeter),
    parsedHorometro: firstFiniteNumber(
      fromText.horometro,
      treatAsBlankFlowStart ? undefined : threadParsed.horometro,
    ),
    combinedText: treatAsBlankFlowStart ? rawText : combinedText,
  });
  const pendingOdoConfirm = hasPendingOdometerConfirmation(threadText);

  if (!patente) {
    if (treatAsBlankFlowStart) {
      const message =
        "Para registrar el cambio de odómetro necesito la patente de la unidad. ¿Cuál es? (podés usar guiones, ej. AB 006 EX, o decime la marca/nombre)";
      await appendOutboundBotMessage(rawPhone, message, {
        source: "wara_odometro_response",
        stage: "missing_plate",
      });
      return NextResponse.json(
        { ok: false, ok_s: "false", error: "Patente requerida", message },
        { status: BB_STATUS },
      );
    }
    const hintText = [rawText, threadText].filter(Boolean).join("\n");
    const fleetPlate = await resolvePlateWithWaraFleet(prisma, rawPhone, hintText, threadText);
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
    const wantsHorometro =
      /\bhor[oó]metro\b/i.test(rawText) ||
      (!/\bod[oó]metro\b/i.test(rawText) && /\bhor[oó]metro\b/i.test(threadText));
    const plateDisplay = formatPlateWithSpaces(patente) ?? patente;
    const message = patente
      ? wantsHorometro
        ? `Perfecto, tomo ${plateDisplay}. ¿Cuál es el nuevo horómetro en horas?`
        : `Perfecto, tomo ${plateDisplay}. ¿Cuál es el nuevo odómetro en km?`
      : "¿Cuál es el nuevo valor de odómetro (en km) o de horómetro (en horas)?";
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
  const fechaExplicita =
    parsed.data.fecha ?? parsed.data.date ?? parseFechaFromText(threadText, customerTz);
  const fecha = fechaWara(fechaExplicita, customerTz);
  const fechaDisplay = fechaExplicita ? formatFechaDisplay(fecha) : null;

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
    (pendingOdoConfirm && isConfirmed(rawText)) ||
    (isConfirmed(rawText) && hasCompleteOdoPayload);

  if (!confirmed) {
    if (pendingOdoConfirm) {
      return NextResponse.json(
        {
          ok: true,
          ok_s: "true",
          flowComplete_s: "true",
          message: "",
          skipResponse_s: "true",
        },
        { status: BB_STATUS },
      );
    }
    const plateDisplay = formatPlateWithSpaces(patente) ?? patente;
    const odoLine =
      typeof odometro === "number"
        ? `• Odómetro: ${odometro} km`
        : typeof horometro === "number"
          ? `• Horómetro: ${horometro} h`
          : "";
    const fechaLine = fechaDisplay ? `\n• Fecha: ${fechaDisplay}` : "";
    const confirmMessage =
      `Voy a registrar:\n• Patente: ${plateDisplay}\n${odoLine}${fechaLine}\n\n` +
      `Si está correcto, respondé CONFIRMO para registrarlo en Wara.`;
    await setPendingAction(prisma, rawPhone, "odometro", {
      summary: confirmMessage,
      payload: { patente, odometro, horometro },
    });
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
  if (!fecha) {
    return NextResponse.json(
      { ok: false, error: "Fecha inválida", message: "La fecha indicada no es válida." },
      { status: BB_STATUS }
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
