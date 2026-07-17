import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendTicketAssignedEmail } from "@/lib/panelEmail";

/** Casos que cuentan para carga del asesor y cola operativa. */
export const ADVISOR_ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
];

export const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

/** Sin heartbeat en este lapso → el asesor no cuenta como conectado. */
export const ADVISOR_PRESENCE_TIMEOUT_MS = 2 * 60 * 1000;

const PRIORITY_RANK: Record<TicketPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

export function isDbAgentUserId(userId: string): boolean {
  return !!userId && !userId.startsWith("panel-");
}

export function sortTicketsByPriority<T extends { priority: TicketPriority; lastMessageAt: Date }>(
  tickets: T[],
): T[] {
  return [...tickets].sort((a, b) => {
    const pd = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (pd !== 0) return pd;
    return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });
}

async function expireStaleAdvisorSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - ADVISOR_PRESENCE_TIMEOUT_MS);
  const stale = await prisma.agentUser.findMany({
    where: {
      role: "SUPPORT",
      sessionActive: true,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
    },
    select: { id: true, name: true },
  });

  if (stale.length === 0) return 0;

  const releaseAt = new Date(Date.now() + DISCONNECT_GRACE_MS);
  for (const agent of stale) {
    await prisma.agentUser.update({
      where: { id: agent.id },
      data: {
        sessionActive: false,
        casesReleaseAt: releaseAt,
      },
    });
    console.log(`[advisorDistribution] Sesión expirada por inactividad: ${agent.name}`);
  }

  return stale.length;
}

async function getActiveSupportAdvisorIds(): Promise<string[]> {
  await expireStaleAdvisorSessions();

  const cutoff = new Date(Date.now() - ADVISOR_PRESENCE_TIMEOUT_MS);
  const rows = await prisma.agentUser.findMany({
    where: {
      role: "SUPPORT",
      sessionActive: true,
      lastSeenAt: { gte: cutoff },
    },
    select: { id: true },
    orderBy: { sessionActiveAt: "asc" },
  });
  return rows.map((r) => r.id);
}

async function countActiveTickets(agentId: string): Promise<number> {
  return prisma.ticket.count({
    where: {
      assignedToUserId: agentId,
      status: { in: ADVISOR_ACTIVE_TICKET_STATUSES },
    },
  });
}

async function notifyAssignment(
  agentUserId: string,
  ticketId: string,
  type: "ASSIGNED" | "REASSIGNED" = "ASSIGNED",
) {
  await prisma.agentNotification.create({
    data: {
      agentUserId,
      ticketId,
      type,
    },
  });

  void (async () => {
    try {
      const [agent, ticket] = await Promise.all([
        prisma.agentUser.findUnique({
          where: { id: agentUserId },
          select: { email: true, name: true },
        }),
        prisma.ticket.findUnique({
          where: { id: ticketId },
          select: {
            id: true,
            code: true,
            title: true,
            customer: { select: { companyName: true, name: true } },
          },
        }),
      ]);
      if (!agent?.email || !ticket) return;

      await sendTicketAssignedEmail({
        to: agent.email,
        agentName: agent.name,
        ticketCode: ticket.code,
        ticketTitle: ticket.title,
        companyName: ticket.customer.companyName || ticket.customer.name || "Cliente",
        ticketId: ticket.id,
        type,
      });
    } catch (err) {
      console.error("[advisorDistribution] Email asignación:", err);
    }
  })();
}

async function assignTicketInternal(
  ticketId: string,
  agentUserId: string,
  options?: { notify?: boolean; notificationType?: "ASSIGNED" | "REASSIGNED" },
) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { assignedToUserId: true },
  });
  if (!ticket) return;

  const previous = ticket.assignedToUserId;
  if (previous === agentUserId) return;

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { assignedToUserId: agentUserId },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId,
      type: "ASSIGNED",
      payload: {
        assignedToUserId: agentUserId,
        previousAssignedToUserId: previous,
        source: "advisor_distribution",
      },
    },
  });

  if (options?.notify !== false) {
    const type =
      options?.notificationType ?? (previous && previous !== agentUserId ? "REASSIGNED" : "ASSIGNED");
    await notifyAssignment(agentUserId, ticketId, type);
  }
}

/** Libera casos de asesores desconectados tras la gracia de 5 minutos. */
export async function processScheduledAdvisorReleases(): Promise<number> {
  const now = new Date();
  const due = await prisma.agentUser.findMany({
    where: {
      sessionActive: false,
      casesReleaseAt: { lte: now },
    },
    select: { id: true, name: true },
  });

  if (due.length === 0) return 0;

  let released = 0;
  for (const agent of due) {
    const result = await prisma.ticket.updateMany({
      where: {
        assignedToUserId: agent.id,
        status: { in: ADVISOR_ACTIVE_TICKET_STATUSES },
      },
      data: { assignedToUserId: null },
    });
    released += result.count;

    await prisma.agentUser.update({
      where: { id: agent.id },
      data: { casesReleaseAt: null },
    });

    if (result.count > 0) {
      console.log(
        `[advisorDistribution] Casos liberados de ${agent.name}: ${result.count} → cola`,
      );
    }
  }

  if (released > 0) {
    await rebalanceAmongActiveAdvisors({ skipReleaseProcessing: true });
  }

  return released;
}

/**
 * Reparte equitativamente casos activos (cola + asignados a asesores activos)
 * entre todos los asesores SUPPORT conectados.
 */
export async function rebalanceAmongActiveAdvisors(options?: {
  skipReleaseProcessing?: boolean;
}): Promise<{ assigned: number; activeAdvisors: number }> {
  if (!options?.skipReleaseProcessing) {
    await processScheduledAdvisorReleases();
  }

  const activeIds = await getActiveSupportAdvisorIds();
  if (activeIds.length === 0) {
    return { assigned: 0, activeAdvisors: 0 };
  }

  const poolTickets = await prisma.ticket.findMany({
    where: {
      status: { in: ADVISOR_ACTIVE_TICKET_STATUSES },
      OR: [{ assignedToUserId: null }, { assignedToUserId: { in: activeIds } }],
    },
    select: { id: true, priority: true, lastMessageAt: true, assignedToUserId: true },
  });

  const sorted = sortTicketsByPriority(poolTickets);
  const loads = new Map<string, number>(activeIds.map((id) => [id, 0]));

  let changes = 0;
  for (const ticket of sorted) {
    const targetId = [...loads.entries()].sort((a, b) => a[1] - b[1])[0]![0];

    if (ticket.assignedToUserId !== targetId) {
      await assignTicketInternal(ticket.id, targetId, {
        notificationType: ticket.assignedToUserId ? "REASSIGNED" : "ASSIGNED",
      });
      changes++;
    }

    loads.set(targetId, (loads.get(targetId) ?? 0) + 1);
  }

  if (changes > 0) {
    console.log(
      `[advisorDistribution] Rebalanceo entre ${activeIds.length} asesor(es): ${changes} movimiento(s)`,
    );
  }

  return { assigned: changes, activeAdvisors: activeIds.length };
}

/** Nuevo caso: va al asesor activo con menos carga; si no hay nadie, queda en cola. */
export async function autoAssignNewTicket(ticketId: string): Promise<boolean> {
  await processScheduledAdvisorReleases();

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true, assignedToUserId: true },
  });
  if (!ticket || !ADVISOR_ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    return false;
  }
  if (ticket.assignedToUserId) return false;

  const activeIds = await getActiveSupportAdvisorIds();
  if (activeIds.length === 0) return false;

  let minId = activeIds[0];
  let minLoad = await countActiveTickets(minId);
  for (const id of activeIds.slice(1)) {
    const load = await countActiveTickets(id);
    if (load < minLoad) {
      minLoad = load;
      minId = id;
    }
  }

  await assignTicketInternal(ticketId, minId, { notificationType: "ASSIGNED" });
  console.log(`[advisorDistribution] Ticket ${ticketId} → asesor ${minId} (carga ${minLoad})`);
  return true;
}

export async function onAdvisorLogin(agentUserId: string): Promise<void> {
  if (!isDbAgentUserId(agentUserId)) return;

  const agent = await prisma.agentUser.findUnique({
    where: { id: agentUserId },
    select: { role: true, name: true },
  });
  if (!agent || agent.role !== "SUPPORT") return;

  await prisma.agentUser.update({
    where: { id: agentUserId },
    data: {
      sessionActive: true,
      sessionActiveAt: new Date(),
      lastSeenAt: new Date(),
      casesReleaseAt: null,
    },
  });

  console.log(`[advisorDistribution] Asesor conectado: ${agent.name}`);
  await rebalanceAmongActiveAdvisors();
}

export async function onAdvisorLogout(agentUserId: string): Promise<void> {
  if (!isDbAgentUserId(agentUserId)) return;

  const agent = await prisma.agentUser.findUnique({
    where: { id: agentUserId },
    select: { role: true, name: true },
  });
  if (!agent || agent.role !== "SUPPORT") return;

  const releaseAt = new Date(Date.now() + DISCONNECT_GRACE_MS);

  await prisma.agentUser.update({
    where: { id: agentUserId },
    data: {
      sessionActive: false,
      lastSeenAt: null,
      casesReleaseAt: releaseAt,
    },
  });

  console.log(
    `[advisorDistribution] Asesor desconectado: ${agent.name}; casos en cola tras ${DISCONNECT_GRACE_MS / 60000} min`,
  );
}

/** Asignación manual (solo admin): notifica in-app, no rebalancea todo el pool. */
export async function adminAssignTicket(
  ticketId: string,
  agentUserId: string | null,
  adminUserId: string,
): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { assignedToUserId: true },
  });
  if (!ticket) return;

  const previous = ticket.assignedToUserId;

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { assignedToUserId: agentUserId },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId,
      type: "ASSIGNED",
      payload: {
        assignedToUserId: agentUserId,
        previousAssignedToUserId: previous,
        source: "admin_manual",
        adminUserId,
      },
    },
  });

  if (agentUserId && agentUserId !== previous) {
    await notifyAssignment(
      agentUserId,
      ticketId,
      previous ? "REASSIGNED" : "ASSIGNED",
    );
  }
}

export function applyAdvisorTicketScope(
  where: Prisma.TicketWhereInput,
  user: { id: string; role: "ADMIN" | "SUPPORT" },
): Prisma.TicketWhereInput {
  if (user.role === "ADMIN") return where;
  if (!isDbAgentUserId(user.id)) return where;
  return {
    AND: [where, { assignedToUserId: user.id }],
  };
}

export async function assertAdvisorCanAccessTicket(
  ticketId: string,
  user: { id: string; role: "ADMIN" | "SUPPORT" },
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  if (!isDbAgentUserId(user.id)) return true;
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { assignedToUserId: true },
  });
  return ticket?.assignedToUserId === user.id;
}

export function isAdvisorPresentlyOnline(agent: {
  sessionActive: boolean;
  lastSeenAt: Date | null;
}): boolean {
  if (!agent.sessionActive || !agent.lastSeenAt) return false;
  return agent.lastSeenAt.getTime() >= Date.now() - ADVISOR_PRESENCE_TIMEOUT_MS;
}

export async function getUnreadNotificationCount(agentUserId: string): Promise<number> {
  if (!isDbAgentUserId(agentUserId)) return 0;
  return prisma.agentNotification.count({
    where: { agentUserId, readAt: null },
  });
}

/** Ping desde el panel: mantiene al asesor como conectado mientras la pestaña esté abierta. */
export async function advisorHeartbeat(agentUserId: string): Promise<{ ok: boolean }> {
  if (!isDbAgentUserId(agentUserId)) return { ok: false };

  const agent = await prisma.agentUser.findUnique({
    where: { id: agentUserId },
    select: { role: true },
  });
  if (!agent || agent.role !== "SUPPORT") return { ok: false };

  await expireStaleAdvisorSessions();

  await prisma.agentUser.update({
    where: { id: agentUserId },
    data: {
      sessionActive: true,
      lastSeenAt: new Date(),
      sessionActiveAt: new Date(),
      casesReleaseAt: null,
    },
  });

  return { ok: true };
}
