import type { Prisma, PrismaClient, Ticket, TicketPriority, TicketStatus } from "@prisma/client";
import { allocateTicketCode } from "@/lib/tickets";

/**
 * ## Regla de conversación (WhatsApp / soporte)
 *
 * **Teléfono canónico:** el número de WhatsApp se guarda solo con dígitos (sin `@s.whatsapp.net`),
 * para que el mismo contacto no genere dos filas `Customer` por formato distinto.
 *
 * **Un solo hilo activo por cliente (teléfono):** mientras exista al menos un ticket
 * en estado abierto (`OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`), los mensajes entrantes
 * y salientes se asocian a **ese** ticket — el de **última actividad** (`lastMessageAt`).
 *
 * **Un asesor por conversación activa:** todos los tickets abiertos del mismo cliente
 * comparten el mismo `assignedToUserId`. No se reparte por ticket suelto.
 *
 * Un ticket nuevo solo se crea cuando **no** hay ningún ticket abierto para ese cliente
 * (p. ej. el caso anterior quedó `RESOLVED` o `CLOSED`). Conversación nueva → asesor online
 * actual, sin preferencia por quien atendió antes.
 */

export const OPEN_TICKET_THREAD_STATUSES: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
];

const PRIORITY_RANK: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export type MergeDuplicateOpenTicketsResult = {
  /** Clientes que tenían más de un ticket abierto */
  customersProcessed: number;
  /** Tickets eliminados tras fusionar (siempre ≥ 0) */
  ticketsMergedAway: number;
  /** IDs de tickets conservados (uno por cliente afectado) */
  keptTicketIds: string[];
};

/** Ticket abierto más reciente del cliente (conversación activa). */
export async function findOpenConversationTicket(
  prisma: PrismaClient,
  customerId: string,
): Promise<Ticket | null> {
  return prisma.ticket.findFirst({
    where: {
      customerId,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
    orderBy: { lastMessageAt: "desc" },
  });
}

/** Asesor dueño de la conversación activa del cliente (si hay alguno asignado). */
export async function findConversationAdvisorId(
  prisma: PrismaClient,
  customerId: string,
): Promise<string | null> {
  const row = await prisma.ticket.findFirst({
    where: {
      customerId,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
      assignedToUserId: { not: null },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { assignedToUserId: true },
  });
  return row?.assignedToUserId ?? null;
}

export type AttachToConversationParams = {
  customerId: string;
  contactName: string;
  title: string;
  messageText: string;
  messagePayload: Prisma.InputJsonObject;
  incidentType?: string | null;
  priority?: TicketPriority;
  status?: TicketStatus;
  aiSummary?: string;
  category?: "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER";
  channel?: "WHATSAPP" | "EMAIL" | "WEB";
};

/**
 * Reutiliza el ticket abierto del cliente o crea uno nuevo si la conversación terminó.
 * Antes fusiona duplicados abiertos del mismo cliente.
 */
export async function attachToOpenConversation(
  prisma: PrismaClient,
  params: AttachToConversationParams,
): Promise<{ ticket: Ticket; created: boolean }> {
  await mergeDuplicateOpenTicketsForCustomer(prisma, params.customerId);

  let ticket = await findOpenConversationTicket(prisma, params.customerId);

  if (ticket) {
    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        direction: "INBOUND",
        from: "CUSTOMER",
        text: params.messageText,
        rawPayload: params.messagePayload,
      },
    });

    const priorityRank = PRIORITY_RANK;
    const nextPriority =
      params.priority &&
      (priorityRank[params.priority] ?? 0) > (priorityRank[ticket.priority] ?? 0)
        ? params.priority
        : ticket.priority;

    ticket = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: new Date(),
        title: params.title,
        ...(params.incidentType !== undefined ? { incidentType: params.incidentType } : {}),
        ...(params.priority ? { priority: nextPriority } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.aiSummary ? { aiSummary: params.aiSummary } : {}),
      },
    });

    return { ticket, created: false };
  }

  const code = await allocateTicketCode(prisma);

  ticket = await prisma.ticket.create({
    data: {
      code,
      customerId: params.customerId,
      contactName: params.contactName,
      title: params.title,
      status: params.status ?? "IN_PROGRESS",
      priority: params.priority ?? "NORMAL",
      category: params.category ?? "TECH_SUPPORT",
      incidentType: params.incidentType ?? null,
      channel: params.channel ?? "WHATSAPP",
      aiSummary: params.aiSummary,
    },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: params.messageText,
      rawPayload: params.messagePayload,
    },
  });

  return { ticket, created: true };
}

/** Fusiona tickets abiertos duplicados de un solo cliente en el más reciente. */
export async function mergeDuplicateOpenTicketsForCustomer(
  prisma: PrismaClient,
  customerId: string,
): Promise<{ mergedAway: number; keptTicketId: string | null }> {
  const tickets = await prisma.ticket.findMany({
    where: {
      customerId,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  if (tickets.length < 2) {
    return { mergedAway: 0, keptTicketId: tickets[0]?.id ?? null };
  }

  const [winner, ...losers] = tickets;
  let ticketsMergedAway = 0;

  await prisma.$transaction(async (tx) => {
    let assigned = winner.assignedToUserId;
    let priority = winner.priority;
    for (const t of losers) {
      if (!assigned && t.assignedToUserId) assigned = t.assignedToUserId;
      if ((PRIORITY_RANK[t.priority] ?? 0) > (PRIORITY_RANK[priority] ?? 0)) {
        priority = t.priority;
      }
    }

    for (const loser of losers) {
      await tx.ticketMessage.updateMany({
        where: { ticketId: loser.id },
        data: { ticketId: winner.id },
      });
      await tx.ticketEvent.updateMany({
        where: { ticketId: loser.id },
        data: { ticketId: winner.id },
      });

      const loserTags = await tx.ticketTag.findMany({ where: { ticketId: loser.id } });
      for (const { tagId } of loserTags) {
        const exists = await tx.ticketTag.findUnique({
          where: { ticketId_tagId: { ticketId: winner.id, tagId } },
        });
        if (!exists) {
          await tx.ticketTag.create({ data: { ticketId: winner.id, tagId } });
        }
      }
      await tx.ticketTag.deleteMany({ where: { ticketId: loser.id } });
      await tx.agentNotification.deleteMany({ where: { ticketId: loser.id } });
      await tx.ticket.delete({ where: { id: loser.id } });
      ticketsMergedAway += 1;
    }

    const lastMsg = await tx.ticketMessage.findFirst({
      where: { ticketId: winner.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const titleBase = winner.title;
    const title =
      losers.length > 0 && !titleBase.includes("(consolidado)")
        ? `${titleBase} (consolidado)`
        : titleBase;

    await tx.ticket.update({
      where: { id: winner.id },
      data: {
        lastMessageAt: lastMsg?.createdAt ?? new Date(),
        assignedToUserId: assigned,
        priority,
        title,
      },
    });
  });

  return { mergedAway: ticketsMergedAway, keptTicketId: winner.id };
}

/**
 * Para cada cliente con más de un ticket en `OPEN_TICKET_THREAD_STATUSES`, deja **uno**:
 * el de `lastMessageAt` más reciente. Los mensajes y eventos de los demás pasan a ese ticket;
 * las etiquetas se unen sin duplicar; los tickets sobrantes se eliminan.
 */
export async function mergeDuplicateOpenTickets(
  prisma: PrismaClient
): Promise<MergeDuplicateOpenTicketsResult> {
  const grouped = await prisma.ticket.groupBy({
    by: ["customerId"],
    where: { status: { in: OPEN_TICKET_THREAD_STATUSES } },
    _count: { _all: true },
  });
  const dupRows = grouped.filter((g) => g._count._all > 1);

  let ticketsMergedAway = 0;
  const keptTicketIds: string[] = [];

  for (const { customerId } of dupRows) {
    const result = await mergeDuplicateOpenTicketsForCustomer(prisma, customerId);
    if (result.mergedAway > 0 && result.keptTicketId) {
      keptTicketIds.push(result.keptTicketId);
      ticketsMergedAway += result.mergedAway;
    }
  }

  return {
    customersProcessed: dupRows.length,
    ticketsMergedAway,
    keptTicketIds,
  };
}
