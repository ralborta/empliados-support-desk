import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendTicketAssignedEmail, sendUnassignedTicketAlertEmail } from "@/lib/panelEmail";
import {
  findConversationAdvisorId,
  mergeDuplicateOpenTicketsForCustomer,
} from "@/lib/ticketThreading";

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

/**
 * Cuando llega un ticket y NO hay ningún asesor SUPPORT conectado, nadie recibe la
 * asignación (ni notificación, ni email) — el caso queda "invisible" hasta que alguien
 * abra el panel. Esto escala a los ADMIN por email + campana, una sola vez por ticket
 * (dedupe con AgentNotification), para que no se pierda un caso real solo porque nadie
 * tenía la pestaña abierta en ese momento. Bug real reportado en producción 2026-07-23.
 */
async function notifyAdminsOfUnassignedTicket(ticketId: string): Promise<void> {
  const admins = await prisma.agentUser.findMany({
    where: { role: "ADMIN" },
    select: { id: true, name: true, email: true },
  });

  const existing = admins.length
    ? await prisma.agentNotification.findMany({
        where: { ticketId, type: "UNASSIGNED_ALERT", agentUserId: { in: admins.map((a) => a.id) } },
        select: { agentUserId: true },
      })
    : [];
  const alreadyNotified = new Set(existing.map((n) => n.agentUserId));
  const pending = admins.filter((a) => !alreadyNotified.has(a.id));

  // El login "Administración" (PANEL_USER_ADMIN_EMAIL/PASSWORD) es una cuenta por
  // variable de entorno, SIN fila en AgentUser (id "panel-admin") — no puede recibir
  // AgentNotification (requiere FK a AgentUser) ni aparecer en la campana, pero sí
  // conviene mandarle el email de alerta. Se deduplica reutilizando TicketEvent (no
  // requiere una tabla nueva). Bug real, producción 2026-07-23: quien loguea con esa
  // cuenta nunca vio "no está asignando y no hay alertas" resuelto porque esta cuenta
  // queda fuera de cualquier alerta basada en AgentUser.
  const envAdminEmail = process.env.PANEL_USER_ADMIN_EMAIL?.trim();
  let envAdminPending = false;
  if (envAdminEmail && !admins.some((a) => a.email?.toLowerCase() === envAdminEmail.toLowerCase())) {
    const envAlreadyNotified = await prisma.ticketEvent.findFirst({
      where: { ticketId, type: "ESCALATED", payload: { path: ["channel"], equals: "env_admin_email" } },
      select: { id: true },
    });
    envAdminPending = !envAlreadyNotified;
  }

  if (pending.length === 0 && !envAdminPending) return;

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      code: true,
      title: true,
      customer: { select: { companyName: true, name: true } },
    },
  });
  if (!ticket) return;
  const companyName = ticket.customer.companyName || ticket.customer.name || "Cliente";

  for (const admin of pending) {
    await prisma.agentNotification.create({
      data: { agentUserId: admin.id, ticketId, type: "UNASSIGNED_ALERT" },
    });

    if (admin.email) {
      void sendUnassignedTicketAlertEmail({
        to: admin.email,
        adminName: admin.name,
        ticketCode: ticket.code,
        ticketTitle: ticket.title,
        companyName,
        ticketId,
      }).catch((err) => console.error("[advisorDistribution] Email alerta sin asignar:", err));
    }
  }

  if (envAdminPending && envAdminEmail) {
    await prisma.ticketEvent.create({
      data: { ticketId, type: "ESCALATED", payload: { channel: "env_admin_email", to: envAdminEmail } },
    });
    void sendUnassignedTicketAlertEmail({
      to: envAdminEmail,
      adminName: "Administración",
      ticketCode: ticket.code,
      ticketTitle: ticket.title,
      companyName,
      ticketId,
    }).catch((err) => console.error("[advisorDistribution] Email alerta sin asignar (env admin):", err));
  }

  console.log(
    `[advisorDistribution] Ticket ${ticketId} sin asesor conectado: alerta enviada a ${pending.length + (envAdminPending ? 1 : 0)} admin(s)`,
  );
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

/** Todos los tickets abiertos del cliente → mismo asesor (una conversación). */
async function assignConversationToAdvisor(
  customerId: string,
  agentUserId: string,
  defaultNotification: "ASSIGNED" | "REASSIGNED" = "ASSIGNED",
): Promise<number> {
  const openTickets = await prisma.ticket.findMany({
    where: {
      customerId,
      status: { in: ADVISOR_ACTIVE_TICKET_STATUSES },
    },
    select: { id: true, assignedToUserId: true },
  });

  let changes = 0;
  for (const t of openTickets) {
    if (t.assignedToUserId === agentUserId) continue;
    await assignTicketInternal(t.id, agentUserId, {
      notificationType: t.assignedToUserId ? "REASSIGNED" : defaultNotification,
    });
    changes++;
  }
  return changes;
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
    // Ningún asesor conectado: los casos liberados (p. ej. por desconexión) quedan en
    // cola sin nadie viéndolos. Alertamos a los ADMIN para no perder casos ya en curso.
    const orphaned = await prisma.ticket.findMany({
      where: { status: { in: ADVISOR_ACTIVE_TICKET_STATUSES }, assignedToUserId: null },
      select: { id: true },
    });
    for (const t of orphaned) {
      await notifyAdminsOfUnassignedTicket(t.id);
    }
    return { assigned: 0, activeAdvisors: 0 };
  }

  const poolTickets = await prisma.ticket.findMany({
    where: {
      status: { in: ADVISOR_ACTIVE_TICKET_STATUSES },
      OR: [{ assignedToUserId: null }, { assignedToUserId: { in: activeIds } }],
    },
    select: {
      id: true,
      customerId: true,
      priority: true,
      lastMessageAt: true,
      assignedToUserId: true,
    },
  });

  const customerIds = [...new Set(poolTickets.map((t) => t.customerId))];
  for (const customerId of customerIds) {
    await mergeDuplicateOpenTicketsForCustomer(prisma, customerId);
  }

  const freshPool = await prisma.ticket.findMany({
    where: {
      status: { in: ADVISOR_ACTIVE_TICKET_STATUSES },
      OR: [{ assignedToUserId: null }, { assignedToUserId: { in: activeIds } }],
    },
    select: {
      id: true,
      customerId: true,
      priority: true,
      lastMessageAt: true,
      assignedToUserId: true,
    },
  });

  const byCustomer = new Map<string, typeof freshPool>();
  for (const ticket of freshPool) {
    const list = byCustomer.get(ticket.customerId) ?? [];
    list.push(ticket);
    byCustomer.set(ticket.customerId, list);
  }

  const conversationUnits = [...byCustomer.entries()]
    .map(([customerId, tickets]) => {
      const best = sortTicketsByPriority(tickets)[0]!;
      return { customerId, tickets, best };
    })
    .sort((a, b) => {
      const pd = PRIORITY_RANK[b.best.priority] - PRIORITY_RANK[a.best.priority];
      if (pd !== 0) return pd;
      return b.best.lastMessageAt.getTime() - a.best.lastMessageAt.getTime();
    });

  const loads = new Map<string, number>(activeIds.map((id) => [id, 0]));

  let changes = 0;
  for (const unit of conversationUnits) {
    const targetId = [...loads.entries()].sort((a, b) => a[1] - b[1])[0]![0];

    for (const ticket of unit.tickets) {
      if (ticket.assignedToUserId !== targetId) {
        await assignTicketInternal(ticket.id, targetId, {
          notificationType: ticket.assignedToUserId ? "REASSIGNED" : "ASSIGNED",
        });
        changes++;
      }
    }

    loads.set(targetId, (loads.get(targetId) ?? 0) + 1);
  }

  if (changes > 0) {
    console.log(
      `[advisorDistribution] Rebalanceo (${conversationUnits.length} conversación(es), ${activeIds.length} asesor(es)): ${changes} movimiento(s)`,
    );
  }

  return { assigned: changes, activeAdvisors: activeIds.length };
}

/** Nuevo caso: hereda asesor de la conversación activa o asigna al conectado con menos carga. */
export async function autoAssignNewTicket(ticketId: string): Promise<boolean> {
  await processScheduledAdvisorReleases();

  let ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, customerId: true, status: true, assignedToUserId: true },
  });
  if (!ticket || !ADVISOR_ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    return false;
  }

  const merged = await mergeDuplicateOpenTicketsForCustomer(prisma, ticket.customerId);
  if (merged.keptTicketId) {
    ticketId = merged.keptTicketId;
    ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, customerId: true, status: true, assignedToUserId: true },
    });
    if (!ticket || !ADVISOR_ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
      return false;
    }
  }

  if (ticket.assignedToUserId) {
    await assignConversationToAdvisor(ticket.customerId, ticket.assignedToUserId);
    return true;
  }

  const conversationAdvisor = await findConversationAdvisorId(prisma, ticket.customerId);
  if (conversationAdvisor) {
    await assignConversationToAdvisor(ticket.customerId, conversationAdvisor, "ASSIGNED");
    console.log(
      `[advisorDistribution] Ticket ${ticketId} → asesor ${conversationAdvisor} (misma conversación)`,
    );
    return true;
  }

  const activeIds = await getActiveSupportAdvisorIds();
  if (activeIds.length === 0) {
    await notifyAdminsOfUnassignedTicket(ticketId);
    return false;
  }

  let minId = activeIds[0];
  let minLoad = await countActiveTickets(minId);
  for (const id of activeIds.slice(1)) {
    const load = await countActiveTickets(id);
    if (load < minLoad) {
      minLoad = load;
      minId = id;
    }
  }

  await assignConversationToAdvisor(ticket.customerId, minId, "ASSIGNED");
  console.log(
    `[advisorDistribution] Conversación ${ticket.customerId} → asesor ${minId} (carga ${minLoad})`,
  );
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

/**
 * Ping desde el panel: mantiene al asesor como conectado mientras la pestaña esté abierta.
 *
 * Si el asesor NO estaba presente (sesión nueva, o venía de un timeout por inactividad),
 * el heartbeat también dispara un reparto de la cola. Esto cubre el caso de una sesión de
 * navegador ya abierta (cookie persistente) que nunca vuelve a pasar por `onAdvisorLogin`:
 * sin este chequeo, los casos sin asignar quedaban "invisibles" hasta el próximo login
 * explícito o el próximo mensaje entrante del cliente.
 */
export async function advisorHeartbeat(
  agentUserId: string,
  currentPage?: string,
): Promise<{ ok: boolean }> {
  if (!isDbAgentUserId(agentUserId)) return { ok: false };

  const agent = await prisma.agentUser.findUnique({
    where: { id: agentUserId },
    select: { role: true, sessionActive: true, lastSeenAt: true },
  });
  if (!agent || agent.role !== "SUPPORT") return { ok: false };

  await expireStaleAdvisorSessions();

  const wasPresent = isAdvisorPresentlyOnline({
    sessionActive: agent.sessionActive,
    lastSeenAt: agent.lastSeenAt,
  });

  await prisma.agentUser.update({
    where: { id: agentUserId },
    data: {
      sessionActive: true,
      lastSeenAt: new Date(),
      sessionActiveAt: new Date(),
      casesReleaseAt: null,
      // presenceStartedAt sólo se pisa al pasar de desconectado a conectado (para el
      // monitor externo de "conectado desde") — nunca en cada heartbeat, a diferencia
      // de sessionActiveAt (que sí se refresca siempre, por el orden de reparto de
      // casos, y por eso no sirve para mostrar "conectado desde").
      ...(wasPresent ? {} : { presenceStartedAt: new Date() }),
      ...(currentPage !== undefined ? { currentPage: currentPage.slice(0, 200) } : {}),
    },
  });

  if (!wasPresent) {
    console.log(`[advisorDistribution] Asesor reconectado vía heartbeat: ${agentUserId}`);
    await rebalanceAmongActiveAdvisors();
  }

  return { ok: true };
}

/**
 * Presencia genérica para roles que NO participan del reparto de casos (ADMIN). Usa los
 * mismos campos que advisorHeartbeat (sessionActive/lastSeenAt/presenceStartedAt/
 * currentPage) para que el monitor externo pueda leerlos igual para cualquier rol, pero
 * sin ninguna de las consecuencias de reparto/cola de advisorHeartbeat.
 */
export async function recordAdminPresence(
  agentUserId: string,
  currentPage?: string,
): Promise<{ ok: boolean }> {
  if (!isDbAgentUserId(agentUserId)) return { ok: false };

  const agent = await prisma.agentUser.findUnique({
    where: { id: agentUserId },
    select: { role: true, sessionActive: true, lastSeenAt: true },
  });
  if (!agent || agent.role !== "ADMIN") return { ok: false };

  const wasPresent = isAdvisorPresentlyOnline({
    sessionActive: agent.sessionActive,
    lastSeenAt: agent.lastSeenAt,
  });

  await prisma.agentUser.update({
    where: { id: agentUserId },
    data: {
      sessionActive: true,
      lastSeenAt: new Date(),
      ...(wasPresent ? {} : { presenceStartedAt: new Date() }),
      ...(currentPage !== undefined ? { currentPage: currentPage.slice(0, 200) } : {}),
    },
  });

  return { ok: true };
}
