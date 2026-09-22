import type { Customer, PrismaClient, Ticket } from "@prisma/client";
import { autoAssignNewTicket } from "@/lib/advisorDistribution";
import { formatCustomerOdooCaseRefForWhatsApp } from "@/lib/customerOdooCaseRef";
import { pauseAtilioForCustomer, reactivateAtilioForCustomer } from "@/lib/atilioBotPause";
import {
  findOpenConversationTicket,
  mergeDuplicateOpenTicketsForCustomer,
  OPEN_TICKET_THREAD_STATUSES,
} from "@/lib/ticketThreading";
import { allocateTicketCode } from "@/lib/tickets";
import { resolveCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

/** Cliente registrado pide asesor — primera derivación al panel. */
export const REGISTERED_ADVISOR_HANDOFF_REPLY =
  "Listo, derivé tu consulta a un asesor de Atención al Cliente. Te van a escribir por este medio a la brevedad.";

/** Reingreso mientras ya hay caso en cola de asesor. */
export const REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY =
  "Ya tenemos tu consulta: un asesor de Atención al Cliente te va a atender lo antes posible por este medio.";

/** Sin SUPPORT conectado: no prometer revisión inmediata. */
export const ADVISOR_OFFLINE_SOON_REPLY =
  "Ahora no hay un asesor conectado en línea; te contactamos apenas esté disponible.";

export function buildAdvisorUnavailableCaseReply(caseRef?: string | null): string {
  const display = caseRef ? formatCustomerOdooCaseRefForWhatsApp(caseRef) : null;
  if (display) {
    return `Tu caso es *${display}*. ${ADVISOR_OFFLINE_SOON_REPLY}`;
  }
  return ADVISOR_OFFLINE_SOON_REPLY;
}

/**
 * Pedido de asesor / caso sin reporte: el texto offline solo si nadie está conectado.
 * Con asesor en línea y caso, el mensaje de siempre (Tu caso #…).
 */
export function buildPresenceAwareAdvisorHandoffReply(opts: {
  advisorOnline: boolean;
  caseRef?: string | null;
  firstNotify?: boolean;
  explicitAdvisorRequest?: boolean;
  reused?: boolean;
  onlineWithCase?: (ref: string) => string;
}): string {
  if (!opts.advisorOnline) {
    return buildAdvisorUnavailableCaseReply(opts.caseRef);
  }
  if (opts.caseRef) {
    if (opts.onlineWithCase) return opts.onlineWithCase(opts.caseRef);
    const display = formatCustomerOdooCaseRefForWhatsApp(opts.caseRef);
    if (opts.explicitAdvisorRequest || !opts.reused) {
      return `Tu caso es *${display}*. Un asesor de Atención al cliente lo va a revisar. Te avisamos por este medio cualquier novedad.`;
    }
    return `Ya tenés un caso en revisión (*${display}*). Un asesor de Atención al cliente te va a contactar por este medio.`;
  }
  if (opts.firstNotify === false) return REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY;
  return REGISTERED_ADVISOR_HANDOFF_REPLY;
}

/** En falta de reporte: si no hay asesor, reemplazar “lo va a revisar” por el aviso offline. */
export function withAdvisorOfflineNoticeIfNeeded(
  message: string,
  advisorOnline: boolean,
): string {
  const text = message.trim();
  if (advisorOnline || !text) return text;
  if (text.includes("no hay un asesor conectado")) return text;
  const replaced = text.replace(
    /Un asesor de Atención al cliente lo (va a revisar|sigue revisando)\.?/gi,
    ADVISOR_OFFLINE_SOON_REPLY,
  );
  if (replaced !== text) return replaced;
  return `${text} ${ADVISOR_OFFLINE_SOON_REPLY}`;
}

/** Fuera de alcance Atilio → transferir por panel Wara (sin Odoo). */
const OUT_OF_SCOPE_HANDOFF_VARIANTS = [
  "Yo no te puedo ayudar con eso, pero te paso con un asistente que va a tomar tu caso para resolverlo.",
  "Eso no lo puedo resolver yo. Te derivo con un asistente para que tome tu consulta y te ayude.",
  "Con ese tema no te puedo ayudar desde acá. Te paso con un asistente que se va a ocupar de tu caso.",
];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function pickOutOfScopeHandoffReply(seed = ""): string {
  const day = new Date().toISOString().slice(0, 10);
  const idx = hashSeed(`${seed}|oos|${day}`) % OUT_OF_SCOPE_HANDOFF_VARIANTS.length;
  return OUT_OF_SCOPE_HANDOFF_VARIANTS[idx]!;
}

export type RegisteredAdvisorHandoffResult = {
  customer: Customer;
  ticket: Ticket;
  isNewTicket: boolean;
  /** Primera derivación en este hilo → mensaje completo al cliente. */
  shouldNotifyCustomer: boolean;
};

/**
 * Cliente registrado pide hablar con un asesor → ticket local + auto-asignación.
 * Solo plataforma Wara (mesa/panel). No crea caso Odoo.
 */
export async function ensureRegisteredAdvisorHandoff(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: {
    contactName?: string;
    messageText?: string;
    source?: string;
    title?: string;
    /**
     * true = pausar bot (blacklist) para que tome el operador.
     * false/omitido = mantener Atilio activo (comportamiento histórico).
     */
    pauseBot?: boolean;
    aiSummary?: string;
  },
): Promise<RegisteredAdvisorHandoffResult> {
  const contactName = opts?.contactName?.trim() || "Cliente Wara";
  const messageText = opts?.messageText?.trim() || "";
  const source = opts?.source ?? "registered_advisor_handoff";
  const title = opts?.title?.trim() || "Cliente solicita asesor humano";
  const pauseBot = opts?.pauseBot === true;

  const customer = await resolveCustomerByWhatsAppNumber(prisma, rawPhone, {
    name: contactName,
  });

  await mergeDuplicateOpenTicketsForCustomer(prisma, customer.id);

  let ticket = await findOpenConversationTicket(prisma, customer.id);
  let isNewTicket = false;

  if (!ticket) {
    const code = await allocateTicketCode(prisma);
    ticket = await prisma.ticket.create({
      data: {
        code,
        customerId: customer.id,
        contactName,
        title,
        status: "OPEN",
        priority: "NORMAL",
        category: "OTHER",
        incidentType: "otro",
        channel: "WHATSAPP",
        aiSummary:
          opts?.aiSummary?.trim() ||
          "Cliente solicita asesor humano por WhatsApp.",
      },
    });
    isNewTicket = true;
  }

  if (messageText) {
    const recent = await prisma.ticketMessage.findFirst({
      where: {
        ticketId: ticket.id,
        direction: "INBOUND",
        from: "CUSTOMER",
        text: messageText,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (!recent) {
      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          direction: "INBOUND",
          from: "CUSTOMER",
          text: messageText,
          rawPayload: { source, registeredAdvisorHandoff: true, platformOnly: true },
        },
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { lastMessageAt: new Date() },
      });
    }
  }

  const priorNotice = await prisma.ticketEvent.findFirst({
    where: {
      ticketId: ticket.id,
      type: "ESCALATED",
      payload: { path: ["reason"], equals: "registered_advisor_handoff_notice" },
    },
    select: { id: true },
  });
  const shouldNotifyCustomer = !priorNotice;
  if (shouldNotifyCustomer) {
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: "ESCALATED",
        payload: {
          reason: "registered_advisor_handoff_notice",
          source,
          phone: customer.phone,
          platformOnly: true,
        },
      },
    });
  }

  try {
    const fresh = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { assignedToUserId: true, status: true },
    });
    if (
      fresh &&
      OPEN_TICKET_THREAD_STATUSES.includes(fresh.status) &&
      !fresh.assignedToUserId
    ) {
      await autoAssignNewTicket(ticket.id);
    }
  } catch (e) {
    console.error("[advisorHandoff] autoAssign:", e);
  }

  if (pauseBot) {
    await pauseAtilioForCustomer(customer.id, prisma, source).catch((e) =>
      console.error("[advisorHandoff] pauseAtilio:", e),
    );
  } else {
    await reactivateAtilioForCustomer(customer.id, prisma, "advisor_handoff_keep_active").catch(
      (e) => console.error("[advisorHandoff] reactivateAtilio:", e),
    );
  }

  const refreshed =
    (await prisma.ticket.findUnique({ where: { id: ticket.id } })) ?? ticket;

  return {
    customer,
    ticket: refreshed,
    isNewTicket,
    shouldNotifyCustomer,
  };
}

/**
 * Fuera de alcance operativo → ticket en panel Wara + mensaje natural.
 * No crea ni toca Odoo.
 */
export async function resolveOutOfScopePlatformHandoff(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: { messageText?: string; seed?: string; source?: string },
): Promise<{ message: string; ticketCode?: string }> {
  const handoff = await ensureRegisteredAdvisorHandoff(prisma, rawPhone, {
    messageText: opts?.messageText,
    source: opts?.source ?? "out_of_scope_platform_handoff",
    title: "Fuera de alcance Kira — derivación a operador",
    aiSummary: "Consulta fuera del alcance operativo de Kira; derivada al panel Wara.",
    pauseBot: true,
  });
  if (!handoff.shouldNotifyCustomer) {
    return {
      message: REGISTERED_ADVISOR_HANDOFF_WAITING_REPLY,
      ticketCode: handoff.ticket.code,
    };
  }
  return {
    message: pickOutOfScopeHandoffReply(opts?.seed ?? rawPhone),
    ticketCode: handoff.ticket.code,
  };
}
