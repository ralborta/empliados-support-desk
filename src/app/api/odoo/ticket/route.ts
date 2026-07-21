import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireBuilderBotContextAuth } from "@/lib/builderbotCustomerContext";
import {
  createHelpdeskTicket,
  getOdooConfig,
  getOdooConfigStatus,
  OdooError,
} from "@/lib/odooApi";
import { detectIncidentType, detectPlate, extractLastPlateFromThread, formatPlateWithSpaces, normalizePlate, threadTextSinceCompanySelection, waraIncidentLabels } from "@/lib/wara";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import {
  consultarEstadoUnidades,
  looksLikeAtilioHelpRequest,
  looksLikeGreeting,
  looksLikeHumanAdvisorRequest,
  resolveWaraSessionByPhone,
} from "@/lib/waraApi";
import { looksLikeUnitListRequest } from "@/lib/waraUnitIntent";
import { bbcShouldSendExecutorMessage } from "@/lib/waraInboundAudit";
import {
  handleCustomerConversationCloseRequest,
  looksLikeCustomerConversationCloseRequest,
} from "@/lib/customerConversationClose";
import {
  buildOpenCaseStatusReply,
  looksLikeOpenCaseStatusInquiry,
} from "@/lib/customerTicketInquiry";
import { ensureWaraOdooTicket } from "@/lib/waraOdooEscalation";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";

/**
 * Crea un ticket de reclamo/escalamiento en Odoo Helpdesk (equipo "Atención al cliente").
 * POST /api/odoo/ticket  (con x-api-key del contexto)
 *
 * Pensado para que BuilderBot mande solo `from` + `rawText` (el mensaje del cliente):
 * el backend resuelve empresa/contacto desde el teléfono, detecta la patente y arma
 * título (`PATENTE - evento`) y descripción con el feedback de Atilio.
 *
 * También acepta campos explícitos (subject/title, plate, event, description, etc.)
 * por si se quiere armar el ticket desde otro lado.
 */
const bodySchema = z
  .object({
    from: z.string().optional(),
    phone: z.string().optional(),
    rawText: z.string().optional(),
    subject: z.string().optional(),
    title: z.string().optional(),
    plate: z.string().optional(),
    patente: z.string().optional(),
    event: z.string().optional(),
    evento: z.string().optional(),
    description: z.string().optional(),
    aiSummary: z.string().optional(),
    customerName: z.string().optional(),
    companyName: z.string().optional(),
    customerEmail: z.string().optional(),
    customerPhone: z.string().optional(),
    priority: z.string().optional(),
    teamId: z.union([z.number(), z.string()]).optional(),
    stageId: z.union([z.number(), z.string()]).optional(),
    api_key: z.string().optional(),
    apiKey: z.string().optional(),
    key: z.string().optional(),
    token: z.string().optional(),
  })
  .refine(
    (d) =>
      Boolean(
        (d.subject ?? d.title ?? "").trim() ||
          (d.plate ?? d.patente ?? "").trim() ||
          (d.rawText ?? "").trim()
      ),
    "Indicá subject/title, plate/patente o rawText."
  );

// BuilderBot Cloud solo mapea el body cuando el status es 2xx; como este endpoint lo
// consume BuilderBot, respondemos siempre 200 y dejamos el estado real en `ok`/`message`.
const BB_STATUS = 200;

function toNumberId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value.trim());
  }
  return undefined;
}

function normalizePlateForTitle(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

/** Evento corto para el título: usa el tipo de incidencia detectado o la 1ª frase del texto. */
function buildEvent(explicit: string | undefined, rawText: string | undefined): string {
  const e = explicit?.trim();
  if (e) return e;
  const text = (rawText ?? "").trim();
  if (text) {
    const incident = detectIncidentType(text);
    if (incident !== "OTHER" && incident !== "GENERAL_TECH") {
      return waraIncidentLabels[incident];
    }
    const firstLine = text.split(/[\n.]/)[0].trim();
    if (firstLine) return firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine;
  }
  return "Consulta/reclamo";
}

/** Convierte segundos en un texto legible: "18 h", "3 d 4 h", "45 min". */
function humanizeElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const totalMin = Math.floor(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const totalHours = Math.floor(totalMin / 60);
  if (totalHours < 24) return `${totalHours} h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
}

/**
 * Consulta el estado real de la unidad en Wara para enriquecer el caso con el dato
 * de la API (ej. "sin reporte hace 18 h"). Nunca bloquea la creación del ticket:
 * ante cualquier error devuelve null.
 */
async function fetchUnitReportInfo(
  rawPhone: string,
  plateWithSpaces: string
): Promise<{ lastReportElapsed?: string; lastReportDate?: string; unidad?: string } | null> {
  try {
    if (!rawPhone || !plateWithSpaces) return null;
    const session = await resolveWaraSessionByPhone(prisma, rawPhone);
    if (!session.ok || !session.sessionToken) return null;
    const result = await consultarEstadoUnidades(session.sessionToken, [plateWithSpaces]);
    if (!result.ok || !result.unidades.length) return null;
    const unidad = result.unidades[0];
    const elapsed = unidad.ultimo_reporte?.hace_segundos;
    return {
      lastReportElapsed:
        typeof elapsed === "number" ? humanizeElapsed(elapsed) : undefined,
      lastReportDate: unidad.ultimo_reporte?.fecha,
      unidad: unidad.unidad,
    };
  } catch {
    return null;
  }
}

/** Reconstruye texto reciente de la conversación desde la base (fallback de patente). */
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
      take: 16,
      select: { text: true },
    });
    return msgs.reverse().map((m) => m.text).filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

async function findRecentOdooRef(rawPhone: string, plate?: string): Promise<string | null> {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return null;
  const msgs = await prisma.ticketMessage.findMany({
    where: {
      direction: "OUTBOUND",
      from: "BOT",
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      ticket: { customerId: customer.id },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { text: true, rawPayload: true },
  });
  const want = (plate ?? "").replace(/\s+/g, "").toUpperCase();
  for (const m of msgs) {
    const payload = m.rawPayload as Record<string, unknown> | null;
    if (payload?.source !== "odoo_ticket" && payload?.source !== "wara_unidades_auto_ticket") continue;
    const msgPlate = String(payload.plate ?? "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (want && msgPlate && msgPlate !== want) continue;
    const ref = String(payload.ref ?? "");
    if (ref && /^\d+$/.test(ref)) return ref;
    const match = m.text?.match(/caso N[°º]\s*(\d+)/i);
    if (match) return match[1];
  }
  for (const m of msgs) {
    const tck = m.text?.match(/TCK-\d{4}-\d{4}-\d+/i);
    if (tck) {
      if (!want) return tck[0];
      const threadPlate = extractLastPlateFromThreadCompat(m.text ?? "");
      if (!threadPlate || threadPlate === want) return tck[0];
    }
  }
  const openTicket = await prisma.ticket.findFirst({
    where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
    orderBy: { lastMessageAt: "desc" },
    select: { code: true, title: true },
  });
  if (openTicket?.code) {
    if (!want) return openTicket.code;
    const titlePlate = normalizePlateForTitle(detectPlate(openTicket.title ?? "") ?? "");
    if (!titlePlate || titlePlate === want) return openTicket.code;
  }
  return null;
}

function extractLastPlateFromThreadCompat(text: string): string | null {
  const plate = extractLastPlateFromThread(text);
  return plate ? normalizePlateForTitle(plate) : null;
}

async function appendOutboundBotMessage(rawPhone: string, text: string, payload: Record<string, unknown>) {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return;
  const targetTicket =
    (await prisma.ticket.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
    })) ??
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
    data: { ticketId: targetTicket.id, direction: "OUTBOUND", from: "BOT", text: message, rawPayload: payload as never },
  });
}

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

export async function POST(req: NextRequest) {
  const authError = requireBuilderBotContextAuth(req);
  if (authError) return authError;

  const cfg = getOdooConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "No pude registrar el caso en este momento. Te derivo con un asesor.",
        error: "Odoo no configurado",
        missing: getOdooConfigStatus().missing,
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
        message: "Para registrar el caso necesito la patente y una breve descripción de lo que pasa.",
        error: "Body inválido",
        details: parsed.error.flatten(),
      },
      { status: BB_STATUS }
    );
  }

  const data = parsed.data;
  const rawPhone = (data.from ?? data.phone ?? data.customerPhone ?? "").trim();

  if (rawPhone && !allowPhoneRequest(rawPhone, 15)) {
    return NextResponse.json(
      {
        ok: false,
        ok_s: "false",
        message: "Recibí muchas solicitudes seguidas. Esperá un momento e intentá de nuevo.",
        error: "rate_limited",
      },
      { status: BB_STATUS },
    );
  }

  if (looksLikeCustomerConversationCloseRequest(data.rawText)) {
    const closeResult = await handleCustomerConversationCloseRequest({
      rawPhone,
      messageText: data.rawText ?? "",
      source: "odoo_ticket",
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        skipResponse_s: bbcShouldSendExecutorMessage() ? "false" : "true",
        flowComplete_s: "true",
        conversationClosed_s: closeResult.closed ? "true" : "false",
        ticketCode: closeResult.ticketCode ?? "",
        message: closeResult.replyMessage,
      },
      { status: BB_STATUS },
    );
  }

  if (looksLikeOpenCaseStatusInquiry(data.rawText)) {
    const message = await buildOpenCaseStatusReply(rawPhone);
    await appendOutboundBotMessage(rawPhone, message, {
      source: "odoo_ticket",
      stage: "open_case_status_inquiry",
    });
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        message,
        skipResponse_s: bbcShouldSendExecutorMessage() ? "false" : "true",
        flowComplete_s: "true",
      },
      { status: BB_STATUS },
    );
  }

  if (looksLikeUnitListRequest(data.rawText ?? "")) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        skipResponse_s: "true",
        message: "",
        flowComplete_s: "true",
      },
      { status: BB_STATUS },
    );
  }

  const rawText = (data.rawText ?? "").trim();
  if (looksLikeGreeting(rawText) || looksLikeAtilioHelpRequest(rawText)) {
    return NextResponse.json(
      {
        ok: true,
        ok_s: "true",
        skipResponse_s: "true",
        message: "",
        flowComplete_s: "true",
      },
      { status: BB_STATUS },
    );
  }

  // Enriquecemos empresa/contacto desde la base local (se persistió en el alta/selección de empresa).
  const localCustomer = rawPhone ? await findCustomerByWhatsAppNumber(prisma, rawPhone) : null;
  let companyName = data.companyName?.trim() || localCustomer?.companyName?.trim() || "";
  if (rawPhone) {
    const waraSession = await resolveWaraSessionByPhone(prisma, rawPhone);
    if (waraSession.companyName?.trim()) companyName = waraSession.companyName.trim();
  }
  const customerName = data.customerName?.trim() || localCustomer?.name?.trim() || "";

  // Patente: explícita -> detectada del mensaje -> historial reciente (solo si el turno es operativo).
  const threadText = await recentThreadText(rawPhone);
  const scopedThread = threadTextSinceCompanySelection(threadText);
  const plateInMessage = detectPlate(rawText);
  const canReuseThreadPlate =
    !looksLikeOpenCaseStatusInquiry(rawText) &&
    !looksLikeCustomerConversationCloseRequest(rawText);
  const plate = normalizePlateForTitle(
    data.plate ??
      data.patente ??
      plateInMessage ??
      (canReuseThreadPlate
        ? extractLastPlateFromThreadCompat(scopedThread) ?? detectPlate(scopedThread)
        : undefined) ??
      undefined,
  );

  const event = buildEvent(data.event ?? data.evento, data.rawText);
  const explicitSubject = (data.subject ?? data.title ?? "").trim();
  const advisorRequest = looksLikeHumanAdvisorRequest(data.rawText);

  if (advisorRequest) {
    const existingAdvisorRef = await findRecentOdooRef(rawPhone, plate || undefined);
    if (existingAdvisorRef) {
      const message = `Ya tenés el caso ${existingAdvisorRef} en revisión. Un asesor de Atención al cliente te va a contactar por este medio. ¿Querés sumar algo más al reclamo?`;
      await appendOutboundBotMessage(rawPhone, message, {
        source: "odoo_ticket",
        stage: "advisor_existing_case",
        ref: existingAdvisorRef,
        plate: plate || undefined,
      });
      return NextResponse.json({
        ok: true,
        ok_s: "true",
        ref: existingAdvisorRef,
        reused: true,
        reused_s: "true",
        message,
      });
    }
  }

  if (!plate && !explicitSubject && !advisorRequest) {
    const message =
      "Para registrar el caso necesito la patente de la unidad y qué está pasando (ej: NKL 940 no reporta desde ayer).";
    await appendOutboundBotMessage(rawPhone, message, {
      source: "odoo_ticket",
      errorStage: "missing_plate",
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

  const ticketRegistrationAttempt = !!plateInMessage || !!explicitSubject || !!plate;
  const existingRef = advisorRequest
    ? null
    : ticketRegistrationAttempt
      ? await findRecentOdooRef(rawPhone, plate || undefined)
      : null;
  if (existingRef && ticketRegistrationAttempt) {
    const message = `Ya existe un caso abierto (N° ${existingRef}) para este reclamo. Un asesor de Atención al cliente lo va a revisar. Te avisamos por este medio cualquier novedad.`;
    await appendOutboundBotMessage(rawPhone, message, {
      source: "odoo_ticket",
      stage: "deduplicated",
      ref: existingRef,
      plate,
    });
    return NextResponse.json({
      ok: true,
      ok_s: "true",
      ref: existingRef,
      reused: true,
      reused_s: "true",
      message,
    });
  }

  const subject =
    explicitSubject ||
    (advisorRequest && !plate
      ? "Cliente solicita asesor humano"
      : plate
        ? `${plate} - ${event}`
        : event);

  // Dato real de la API de Wara para enriquecer el evento (ej. "sin reporte hace 18 h").
  const plateWithSpaces = plate ? formatPlateWithSpaces(plate) ?? plate : "";
  const unitInfo = plateWithSpaces ? await fetchUnitReportInfo(rawPhone, plateWithSpaces) : null;
  const eventWithData =
    unitInfo?.lastReportElapsed && /falta de reporte|no reporta|sin reporte|offline/i.test(`${event} ${data.rawText ?? ""}`)
      ? `${event} (sin reporte hace ${unitInfo.lastReportElapsed})`
      : event;

  const descriptionLines = [
    data.description?.trim() || data.rawText?.trim() || "",
    data.aiSummary?.trim() ? `Resumen Atilio: ${data.aiSummary.trim()}` : "",
    companyName ? `Empresa Wara: ${companyName}` : "",
    plate ? `Patente: ${plate}` : "",
    `Evento: ${eventWithData}`,
    unitInfo?.lastReportDate ? `Último reporte (Wara): ${unitInfo.lastReportDate}` : "",
    customerName ? `Contacto: ${customerName}` : "",
    rawPhone ? `WhatsApp: ${rawPhone}` : "",
    "Origen: Atilio / WhatsApp",
  ];
  const description = descriptionLines.filter(Boolean).join("\n");

  const dedupeKey = `odoo_ticket:${rawPhone}:${plate || "no-plate"}:${subject.slice(0, 120)}`;
  const localTicket =
    localCustomer &&
    (await prisma.ticket.findFirst({
      where: { customerId: localCustomer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    }));

  try {
    if (localTicket) {
      const ensured = await ensureWaraOdooTicket(prisma, {
        ticketId: localTicket.id,
        dedupeKey,
        subject,
        description,
        customerName,
        customerPhone: rawPhone || data.customerPhone,
        companyName,
        priority: data.priority,
        messageSource: "odoo_ticket",
        messagePlate: plate || undefined,
        logContext: "odoo_ticket",
      });

      if (ensured.odooRef) {
        const ref = ensured.odooRef;
        const message = ensured.created
          ? `Listo, generé el caso N° ${ref} y un asesor de Atención al cliente lo va a revisar. Te avisamos por este medio cualquier novedad.`
          : `Ya tenés el caso ${ref} en revisión. Un asesor de Atención al cliente te va a contactar por este medio.`;

        if (ensured.created) {
          await appendOutboundBotMessage(rawPhone, message, {
            source: "odoo_ticket",
            ref,
            plate,
            companyName,
            odooDedupeKey: dedupeKey,
          });
        }

        return NextResponse.json({
          ok: true,
          ok_s: "true",
          ref,
          reused: !ensured.created,
          reused_s: ensured.created ? "false" : "true",
          message,
        });
      }
    }

    const result = await createHelpdeskTicket(cfg, {
      subject,
      description,
      customerName,
      companyName,
      customerEmail: data.customerEmail,
      customerPhone: rawPhone || data.customerPhone,
      priority: data.priority,
      teamId: toNumberId(data.teamId),
      stageId: toNumberId(data.stageId),
    });

    const ref = result.ref ?? String(result.ticketId);
    const message = `Listo, generé el caso N° ${ref} y un asesor de Atención al cliente lo va a revisar. Te avisamos por este medio cualquier novedad.`;

    await appendOutboundBotMessage(rawPhone, message, {
      source: "odoo_ticket",
      ticketId: result.ticketId,
      ref: result.ref,
      plate,
      companyName,
    });

    return NextResponse.json({
      ok: true,
      ok_s: "true",
      ticketId: result.ticketId,
      ref: result.ref,
      url: result.url,
      message,
    });
  } catch (e) {
    const detail = e instanceof OdooError ? e.message : String(e);
    console.error(`[OdooTicket] Error creando ticket (phone=${rawPhone}): ${detail}`);
    const message = "No pude registrar el caso automáticamente. Te derivo con un asesor para que lo cargue.";
    await appendOutboundBotMessage(rawPhone, message, { source: "odoo_ticket", errorStage: "create", detail });
    return NextResponse.json(
      { ok: false, ok_s: "false", message, error: "Error de Odoo", detail },
      { status: BB_STATUS }
    );
  }
}
