import type { Customer, PrismaClient, Ticket } from "@prisma/client";
import { autoAssignNewTicket } from "@/lib/advisorDistribution";
import { reactivateAtilioForCustomer } from "@/lib/atilioBotPause";
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

export type RegisteredAdvisorHandoffResult = {
  customer: Customer;
  ticket: Ticket;
  isNewTicket: boolean;
  /** Primera derivación en este hilo → mensaje completo al cliente. */
  shouldNotifyCustomer: boolean;
};

/**
 * Cliente registrado pide hablar con un asesor → ticket local + auto-asignación.
 * Odoo Helpdesk es opcional (capa aparte); el panel siempre debe quedar informado.
 */
export async function ensureRegisteredAdvisorHandoff(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: {
    contactName?: string;
    messageText?: string;
    source?: string;
    title?: string;
  },
): Promise<RegisteredAdvisorHandoffResult> {
  const contactName = opts?.contactName?.trim() || "Cliente Wara";
  const messageText = opts?.messageText?.trim() || "";
  const source = opts?.source ?? "registered_advisor_handoff";
  const title = opts?.title?.trim() || "Cliente solicita asesor humano";

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
        aiSummary: "Cliente solicita asesor humano por WhatsApp.",
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
          rawPayload: { source, registeredAdvisorHandoff: true },
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

  await reactivateAtilioForCustomer(customer.id, prisma, "advisor_handoff_keep_active").catch(
    (e) => console.error("[advisorHandoff] reactivateAtilio:", e),
  );

  const refreshed =
    (await prisma.ticket.findUnique({ where: { id: ticket.id } })) ?? ticket;

  return {
    customer,
    ticket: refreshed,
    isNewTicket,
    shouldNotifyCustomer,
  };
}
