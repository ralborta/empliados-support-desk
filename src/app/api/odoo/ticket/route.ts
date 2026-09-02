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
import { detectIncidentType, detectPlate, extractLastPlateFromThread, formatPlateWithSpaces, isPlausibleVehiclePlate, looksLikePostAdvisorCaseSupplement, looksLikeStructuredOdometerUpdateRequest, normalizePlate, threadTextSinceCompanySelection, waraIncidentLabels } from "@/lib/wara";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import {
  consultarEstadoUnidades,
  looksLikeAtilioHelpRequest,
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeGpsFeatureIssueForAdvisor,
  looksLikeGreeting,
  looksLikeHumanAdvisorRequest,
  looksLikeOpenNewCaseRequest,
  looksLikeOutOfScopeSupportClaim,
  looksLikeFleetWideOutageClaim,
  looksLikeTechnicalSupportRequest,
  looksLikeVehicleBrandOrUnitSearch,
  resolveWaraSessionByPhone,
} from "@/lib/waraApi";
import {
  buildFleetUnitNotFoundMessage,
  extractExplicitUnitSearchLabel,
  looksLikeUnitListRequest,
  resolveUnitQuery,
} from "@/lib/waraUnitIntent";
import { bbcShouldSendExecutorMessage } from "@/lib/waraInboundAudit";
import {
  handleCustomerConversationCloseRequest,
  looksLikeCustomerConversationCloseRequest,
} from "@/lib/customerConversationClose";
import {
  buildCaseResolutionEtaReply,
  buildOpenCaseStatusReply,
  looksLikeCaseResolutionEtaInquiry,
  looksLikeOpenCaseStatusInquiry,
} from "@/lib/customerTicketInquiry";
import {
  buildCustomerOdooCaseAssignedReply,
  findCustomerVisibleOdooCaseRef,
  formatCustomerOdooCaseRefForWhatsApp,
} from "@/lib/customerOdooCaseRef";
import { ensureWaraOdooTicket } from "@/lib/waraOdooEscalation";
import { autoAssignNewTicket } from "@/lib/advisorDistribution";
import {
  ensureRegisteredAdvisorHandoff,
  REGISTERED_ADVISOR_HANDOFF_REPLY,
  REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY,
} from "@/lib/advisorHandoff";
import { maybeNotifyFleetOutageOpsAlert } from "@/lib/fleetOutageOpsAlert";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";

function fireFleetOutageOpsAlertBestEffort(params: {
  ticketId: string;
  customerPhone: string;
  customerName?: string;
  companyName?: string;
  ticketCode?: string;
  messageText: string;
}): void {
  void maybeNotifyFleetOutageOpsAlert(prisma, params).catch((e) =>
    console.error("[odoo/ticket] fleetOutageOpsAlert:", e),
  );
}

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

function buildAdvisorSupportFollowupMessage(rawText: string, opts?: { hasCaseRef?: boolean }): string {
  const t = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const mentionsFleet = /\b(unidades|flota|moviles|movil)\b/.test(t);
  const asksAboutWeb = /\b(web|pagina|portal|plataforma|sistema|app|aplicacion)\b/.test(t);
  const prompt =
    mentionsFleet || asksAboutWeb
      ? "Contame, por favor, qué estabas intentando hacer, si te pasa con todas las unidades o solo algunas, y si te aparece algún error o imagen."
      : "Contame, por favor, un poco más de detalle de lo que pasó y si te apareció algún error o imagen.";
  return opts?.hasCaseRef
    ? `Ya tenés un caso en revisión. Un asesor de Atención al cliente lo va a seguir por este medio. ${prompt}`
    : `Ya derivé esto a un asesor de Atención al cliente para que lo revise. ${prompt}`;
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
  return findCustomerVisibleOdooCaseRef(prisma, {
    customerId: customer.id,
    plate,
  });
}

/**
 * Cierra el ticket local abierto para poder abrir un caso nuevo (pedido explícito del cliente).
 * Conserva historial; marca RESOLVED con fuente customer_new_case_request.
 */
async function closeOpenTicketForNewCaseRequest(params: {
  rawPhone: string;
  messageText: string;
}): Promise<{ closed: boolean; previousTicketId: string | null }> {
  const customer = await findCustomerByWhatsAppNumber(prisma, params.rawPhone);
  if (!customer) return { closed: false, previousTicketId: null };

  const openTicket = await prisma.ticket.findFirst({
    where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!openTicket) return { closed: false, previousTicketId: null };

  const inboundText = params.messageText.trim() || "Cliente pidió abrir un nuevo caso";
  await prisma.ticketMessage.create({
    data: {
      ticketId: openTicket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: inboundText,
      rawPayload: {
        source: "customer_new_case_request",
        customerRequestedNewCase: true,
      },
    },
  });

  await prisma.ticket.update({
    where: { id: openTicket.id },
    data: {
      status: "RESOLVED",
      resolution: "CHAT_RESOLVED",
      lastMessageAt: new Date(),
      aiSummary:
        openTicket.aiSummary ??
        `Cerrado a pedido del cliente para abrir un caso nuevo (${inboundText.slice(0, 120)}).`,
    },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId: openTicket.id,
      type: "STATUS_CHANGED",
      payload: {
        status: "RESOLVED",
        resolution: "CHAT_RESOLVED",
        source: "customer_whatsapp_new_case_request",
        message: params.messageText,
      },
    },
  });

  return { closed: true, previousTicketId: openTicket.id };
}

function extractLastPlateFromThreadCompat(text: string): string | null {
  const plate = extractLastPlateFromThread(text);
  return plate && isPlausibleVehiclePlate(plate) ? normalizePlateForTitle(plate) : null;
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
  const cfg = getOdooConfig();

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

  if (looksLikeCaseResolutionEtaInquiry(data.rawText)) {
    const message = await buildCaseResolutionEtaReply(rawPhone);
    await appendOutboundBotMessage(rawPhone, message, {
      source: "odoo_ticket",
      stage: "case_resolution_eta_inquiry",
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
  if (looksLikeStructuredOdometerUpdateRequest(rawText)) {
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
  let plate = normalizePlateForTitle(
    data.plate ??
      data.patente ??
      plateInMessage ??
      (canReuseThreadPlate
        ? extractLastPlateFromThreadCompat(scopedThread) ?? detectPlate(scopedThread)
        : undefined) ??
      undefined,
  );

  if (looksLikePostAdvisorCaseSupplement(rawText, scopedThread)) {
    const existingRef = await findRecentOdooRef(rawPhone);
    if (existingRef) {
      const message = `Perfecto, anoté este detalle en tu caso. Un asesor lo va a revisar con esa información.`;
      await appendOutboundBotMessage(rawPhone, message, {
        source: "odoo_ticket",
        stage: "advisor_case_supplement",
        ref: existingRef,
      });
      if (localCustomer) {
        const openTicket = await prisma.ticket.findFirst({
          where: { customerId: localCustomer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
          orderBy: { lastMessageAt: "desc" },
        });
        if (openTicket) {
          await prisma.ticketMessage.create({
            data: {
              ticketId: openTicket.id,
              direction: "INBOUND",
              from: "CUSTOMER",
              text: rawText,
              rawPayload: { source: "advisor_case_supplement", odooRef: existingRef },
            },
          });
        }
      }
      return NextResponse.json({
        ok: true,
        ok_s: "true",
        ref: existingRef,
        reused: true,
        reused_s: "true",
        message,
      });
    }
  }

  const event = buildEvent(data.event ?? data.evento, data.rawText);
  const explicitSubject = (data.subject ?? data.title ?? "").trim();
  const advisorRequest = looksLikeHumanAdvisorRequest(data.rawText);
  const outOfScopeSupport = looksLikeOutOfScopeSupportClaim(data.rawText);
  const fleetWideOutage = looksLikeFleetWideOutageClaim(data.rawText);
  const technicalSupport = looksLikeTechnicalSupportRequest(data.rawText);
  const openNewCase = looksLikeOpenNewCaseRequest(data.rawText);
  const gpsFeatureIssue = looksLikeGpsFeatureIssueForAdvisor(data.rawText);
  const advisorSupportFollowup =
    !openNewCase && (outOfScopeSupport || (technicalSupport && !advisorRequest));
  // Reclamo fuera de alcance Atilio (pantalla táctil, etc.) o pedido explícito de
  // reclamo/ticket → derivar y asignar SIN exigir patente ni # de caso previo.
  const handoffToAdvisor =
    advisorRequest ||
    looksLikeExplicitReclamoOrTicketRequest(data.rawText) ||
    outOfScopeSupport;

  let advisorHandoffLocal: Awaited<ReturnType<typeof ensureRegisteredAdvisorHandoff>> | null =
    null;
  let closedPreviousForNewCase = false;

  if (handoffToAdvisor) {
    if (openNewCase && rawPhone) {
      const closed = await closeOpenTicketForNewCaseRequest({
        rawPhone,
        messageText: rawText,
      });
      closedPreviousForNewCase = closed.closed;
    }

    // Pedido de caso NUEVO: no reutilizar el Odoo del caso que acabamos de cerrar.
    const existingAdvisorRef = openNewCase
      ? null
      : await findRecentOdooRef(rawPhone, plate || undefined);
    if (existingAdvisorRef) {
      const message = advisorSupportFollowup
        ? buildAdvisorSupportFollowupMessage(rawText, { hasCaseRef: true })
        : gpsFeatureIssue
          ? `Perfecto, anoté este detalle en tu caso. Un asesor de Atención al cliente lo va a revisar con esa información.`
          : `Ya tenés un caso en revisión. Un asesor de Atención al cliente te va a contactar por este medio. ¿Querés sumar algo más al reclamo?`;
      await appendOutboundBotMessage(rawPhone, message, {
        source: "odoo_ticket",
        stage: gpsFeatureIssue ? "advisor_case_supplement" : "advisor_existing_case",
        ref: existingAdvisorRef,
        plate: plate || undefined,
      });
      if (localCustomer && (gpsFeatureIssue || fleetWideOutage)) {
        const openTicket = await prisma.ticket.findFirst({
          where: { customerId: localCustomer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
          orderBy: { lastMessageAt: "desc" },
        });
        if (openTicket) {
          if (gpsFeatureIssue) {
            await prisma.ticketMessage.create({
              data: {
                ticketId: openTicket.id,
                direction: "INBOUND",
                from: "CUSTOMER",
                text: rawText,
                rawPayload: { source: "advisor_case_supplement", odooRef: existingAdvisorRef },
              },
            });
          }
          if (fleetWideOutage) {
            fireFleetOutageOpsAlertBestEffort({
              ticketId: openTicket.id,
              customerPhone: rawPhone,
              customerName: customerName || undefined,
              companyName: companyName || undefined,
              ticketCode: openTicket.code,
              messageText: rawText,
            });
          }
        }
      }
      return NextResponse.json({
        ok: true,
        ok_s: "true",
        ref: existingAdvisorRef,
        reused: true,
        reused_s: "true",
        message,
      });
    }

    if (rawPhone) {
      advisorHandoffLocal = await ensureRegisteredAdvisorHandoff(prisma, rawPhone, {
        contactName: customerName || undefined,
        messageText: rawText || undefined,
        source: openNewCase ? "odoo_ticket_new_case" : "odoo_ticket",
        title: openNewCase
          ? "Cliente solicitó abrir un nuevo caso"
          : fleetWideOutage
            ? "Falla masiva de flota"
            : advisorRequest
            ? "Cliente solicita asesor humano"
            : gpsFeatureIssue
              ? rawText.slice(0, 120).trim() || "GPS: etapas / recorrido"
              : rawText.slice(0, 120).trim() || "Reclamo / soporte",
        // Fuera de alcance: solo mesa Wara; pausar bot para el operador.
        pauseBot: outOfScopeSupport,
        aiSummary: fleetWideOutage
          ? "Falla masiva de flota — derivación a operador + alerta ops WA."
          : outOfScopeSupport
          ? "Fuera de alcance Atilio — derivación a operador (panel Wara, sin Odoo)."
          : undefined,
      });

      // Fuera de alcance: NUNCA crear Helpdesk Odoo — solo ticket local + mensaje.
      if (outOfScopeSupport) {
        const { pickOutOfScopeHandoffReply } = await import("@/lib/advisorHandoff");
        const message = advisorHandoffLocal.shouldNotifyCustomer
          ? pickOutOfScopeHandoffReply(rawPhone)
          : REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY;
        await appendOutboundBotMessage(rawPhone, message, {
          source: "odoo_ticket",
          stage: "out_of_scope_platform_only",
          ticketCode: advisorHandoffLocal.ticket.code,
        });
        if (fleetWideOutage) {
          fireFleetOutageOpsAlertBestEffort({
            ticketId: advisorHandoffLocal.ticket.id,
            customerPhone: rawPhone,
            customerName: customerName || undefined,
            companyName: companyName || undefined,
            ticketCode: advisorHandoffLocal.ticket.code,
            messageText: rawText,
          });
        }
        return NextResponse.json({
          ok: true,
          ok_s: "true",
          message,
          ticketCode: advisorHandoffLocal.ticket.code,
          skipResponse_s: bbcShouldSendExecutorMessage() ? "false" : "true",
          flowComplete_s: "true",
          platformOnly_s: "true",
        });
      }

      if (!cfg) {
        const message = openNewCase
          ? closedPreviousForNewCase
            ? "Cerré el caso anterior y abrí uno nuevo. Un asesor de Atención al cliente te va a contactar por este medio. Contame el detalle del reclamo."
            : "Abrí un caso nuevo. Un asesor de Atención al cliente te va a contactar por este medio. Contame el detalle del reclamo."
          : advisorSupportFollowup
            ? buildAdvisorSupportFollowupMessage(rawText)
            : advisorHandoffLocal.shouldNotifyCustomer
              ? REGISTERED_ADVISOR_HANDOFF_REPLY
              : REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY;
        await appendOutboundBotMessage(rawPhone, message, {
          source: "odoo_ticket",
          stage: openNewCase ? "advisor_handoff_new_case_local_only" : "advisor_handoff_local_only",
          ticketCode: advisorHandoffLocal.ticket.code,
          closedPrevious: closedPreviousForNewCase,
        });
        return NextResponse.json({
          ok: true,
          ok_s: "true",
          message,
          ticketCode: advisorHandoffLocal.ticket.code,
          skipResponse_s: bbcShouldSendExecutorMessage() ? "false" : "true",
          flowComplete_s: "true",
        });
      }
    }
  }

  if (!plate && !explicitSubject && !handoffToAdvisor) {
    if (looksLikeVehicleBrandOrUnitSearch(rawText)) {
      const waraSession = await resolveWaraSessionByPhone(prisma, rawPhone);
      if (waraSession.sessionToken) {
        const fleet = await consultarEstadoUnidades(waraSession.sessionToken, []);
        if (fleet.ok) {
          const resolved = await resolveUnitQuery({
            rawText,
            threadText: scopedThread,
            units: fleet.unidades,
            preferAi: true,
          });
          if (resolved.intent === "consult_status" && resolved.plate) {
            plate = normalizePlateForTitle(resolved.plate);
          } else {
            const message =
              resolved.clarificationQuestion ??
              buildFleetUnitNotFoundMessage({
                companyName,
                rawText,
                searchedText: extractExplicitUnitSearchLabel(rawText) ?? undefined,
              });
            await appendOutboundBotMessage(rawPhone, message, {
              source: "odoo_ticket",
              errorStage: "unit_not_in_fleet",
            });
            return NextResponse.json(
              {
                ok: false,
                ok_s: "false",
                message,
                missing: ["patente"],
                missing_s: "patente",
              },
              { status: BB_STATUS },
            );
          }
        }
      }
    }
    if (!plate) {
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
  }

  const ticketRegistrationAttempt = !!plateInMessage || !!explicitSubject || !!plate;
  const existingRef = handoffToAdvisor
    ? null
    : ticketRegistrationAttempt
      ? await findRecentOdooRef(rawPhone, plate || undefined)
      : null;
  if (existingRef && ticketRegistrationAttempt && !looksLikeStructuredOdometerUpdateRequest(rawText)) {
    const message = `Ya existe un caso abierto para este reclamo. Un asesor de Atención al cliente lo va a revisar. Te avisamos por este medio cualquier novedad.`;
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
    (handoffToAdvisor && !plate
      ? openNewCase
        ? "Cliente solicitó abrir un nuevo caso"
        : advisorRequest
          ? "Cliente solicita asesor humano"
          : gpsFeatureIssue
            ? rawText.slice(0, 120).trim() || "GPS: etapas / recorrido"
            : rawText.slice(0, 120).trim() || event || "Reclamo / soporte"
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
  const localTicket = advisorHandoffLocal
    ? { id: advisorHandoffLocal.ticket.id }
    : localCustomer &&
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
        const message = openNewCase
          ? closedPreviousForNewCase
            ? `Cerré el caso anterior y abrí el caso *${formatCustomerOdooCaseRefForWhatsApp(ref)}*. Un asesor de Atención al cliente lo va a revisar. Contame el detalle del reclamo si aún no lo hiciste.`
            : `Abrí el caso *${formatCustomerOdooCaseRefForWhatsApp(ref)}*. Un asesor de Atención al cliente lo va a revisar. Contame el detalle del reclamo.`
          : advisorSupportFollowup
            ? buildAdvisorSupportFollowupMessage(rawText, { hasCaseRef: !ensured.created })
            : buildCustomerOdooCaseAssignedReply(ref, { reused: !ensured.created });

        if (handoffToAdvisor) {
          try {
            await autoAssignNewTicket(localTicket.id);
          } catch (e) {
            console.error("[OdooTicket] autoAssign:", e);
          }
        }

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

    if (!cfg) {
      return NextResponse.json(
        {
          ok: false,
          ok_s: "false",
          message: "No pude registrar el caso en este momento. Te derivo con un asesor.",
          error: "Odoo no configurado",
          missing: getOdooConfigStatus().missing,
        },
        { status: BB_STATUS },
      );
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

    const ref = result.ref ?? null;
    const message = advisorSupportFollowup
      ? buildAdvisorSupportFollowupMessage(rawText, { hasCaseRef: !!ref })
      : ref
        ? buildCustomerOdooCaseAssignedReply(ref)
        : `Listo, generé tu caso y un asesor de Atención al cliente lo va a revisar. Te avisamos por este medio cualquier novedad.`;

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
