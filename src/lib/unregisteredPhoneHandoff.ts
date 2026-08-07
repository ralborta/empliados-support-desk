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

/** Asunto visible en el panel para números que Wara no reconoce. */
export const UNREGISTERED_PHONE_TICKET_TITLE = "Número no registrado en Wara";

/**
 * Si el cliente escribe de nuevo tras la derivación: calma, sin repetir el aviso largo
 * ni pausar Atilio (Atilio sigue respondiendo este mensaje).
 */
export const UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY =
  "Ya tenemos tu consulta: un asesor de Atención al Cliente de WARA te va a atender lo antes posible por este medio. Gracias por tu paciencia.";

export type UnregisteredPhoneHandoffResult = {
  customer: Customer;
  ticket: Ticket;
  /** Se creó el ticket en este llamado (primera derivación). */
  isNewTicket: boolean;
  /** Primera vez: mensaje BBC de “no registrado / te derivamos”. Después: mensaje de calma. */
  shouldNotifyCustomer: boolean;
};

/**
 * Número no validado por Wara → espejo local + ticket en panel + asignación a asesor.
 *
 * Antes solo se mandaba el mensaje BBC "vamos a derivarte" sin crear nada
 * (skippedUnknownCustomer), y el cliente quedaba en loop sin entrar al backoffice.
 */
export async function ensureUnregisteredPhoneAdvisorHandoff(
  prisma: PrismaClient,
  rawPhone: string,
  opts?: {
    contactName?: string;
    messageText?: string;
    source?: string;
  },
): Promise<UnregisteredPhoneHandoffResult> {
  const contactName =
    opts?.contactName?.trim() || "Contacto no registrado en Wara";
  const messageText = opts?.messageText?.trim() || "";
  const source = opts?.source ?? "unregistered_phone_handoff";

  const customer = await resolveCustomerByWhatsAppNumber(prisma, rawPhone, {
    name: contactName,
  });

  if (!customer.companyName?.trim()) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { companyName: "No registrado en Wara" },
    });
  }

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
        title: UNREGISTERED_PHONE_TICKET_TITLE,
        status: "OPEN",
        priority: "NORMAL",
        category: "OTHER",
        incidentType: "otro",
        channel: "WHATSAPP",
        aiSummary:
          "WhatsApp no validado por Wara (ObtenerContactosPorNumero). Derivado a Atención al Cliente.",
      },
    });
    isNewTicket = true;
    console.log(
      `[unregisteredHandoff] Ticket ${ticket.code} creado para ${customer.phone} (${source})`,
    );
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
          rawPayload: { source, unregisteredPhoneHandoff: true },
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
      payload: { path: ["reason"], equals: "unregistered_phone_notice" },
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
          reason: "unregistered_phone_notice",
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
    console.error("[unregisteredHandoff] autoAssign:", e);
  }

  // Regla: número no registrado NO pausa Atilio — debe poder mandar el aviso de calma.
  await reactivateAtilioForCustomer(
    customer.id,
    prisma,
    "unregistered_phone_handoff_keep_active",
  ).catch((e) => console.error("[unregisteredHandoff] reactivateAtilio:", e));

  const refreshed =
    (await prisma.ticket.findUnique({ where: { id: ticket.id } })) ?? ticket;

  return {
    customer,
    ticket: refreshed,
    isNewTicket,
    shouldNotifyCustomer,
  };
}
