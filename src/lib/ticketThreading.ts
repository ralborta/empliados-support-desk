import type { PrismaClient, TicketStatus } from "@prisma/client";

/**
 * ## Regla de conversación (WhatsApp / soporte)
 *
 * **Un solo hilo activo por cliente (teléfono):** mientras exista al menos un ticket
 * en estado abierto (`OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`), los mensajes entrantes
 * y salientes se asocian a **ese** ticket — el de **última actividad** (`lastMessageAt`).
 *
 * No se abre un ticket nuevo por matrícula distinta ni por pasar 48 h si el anterior sigue abierto.
 * Un ticket nuevo solo se crea cuando **no** hay ningún ticket en esos estados para ese cliente
 * (p. ej. el caso anterior quedó `RESOLVED` o `CLOSED`).
 *
 * La función `mergeDuplicateOpenTickets` corrige datos viejos: si ya hay varios tickets abiertos
 * para el mismo cliente, los une en uno solo (mensajes y eventos al ticket ganador).
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
    const tickets = await prisma.ticket.findMany({
      where: {
        customerId,
        status: { in: OPEN_TICKET_THREAD_STATUSES },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    if (tickets.length < 2) continue;

    const [winner, ...losers] = tickets;
    keptTicketIds.push(winner.id);

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

        const loserTags = await tx.ticketTag.findMany({
          where: { ticketId: loser.id },
        });
        for (const { tagId } of loserTags) {
          const exists = await tx.ticketTag.findUnique({
            where: { ticketId_tagId: { ticketId: winner.id, tagId } },
          });
          if (!exists) {
            await tx.ticketTag.create({
              data: { ticketId: winner.id, tagId },
            });
          }
        }
        await tx.ticketTag.deleteMany({ where: { ticketId: loser.id } });

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
  }

  return {
    customersProcessed: dupRows.length,
    ticketsMergedAway,
    keptTicketIds,
  };
}
