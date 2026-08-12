import { prisma } from "@/lib/db";
import { threadTextSinceCompanySelection } from "@/lib/wara";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

/** Contexto de hilo único para context + classify + ejecutores. */
export type TurnThreadContext = {
  /** Mensajes persistidos (panel), hasta `take` entradas. */
  fullThread: string;
  /** Solo desde la última selección / cambio de empresa. */
  scopedThread: string;
  /**
   * Hilo para clasificar intención: scoped + turno actual.
   * Evita perder confirmaciones cuando el inbound aún no se persistió.
   */
  classificationThread: string;
};

const DEFAULT_THREAD_TAKE = 48;

function normTurnText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * BuilderBot puede volver a ejecutar Inicio→Router con el mismo mensaje del cliente
 * después de un subflujo informativo. Si ya hubo respuesta del bot, ignorar el re-proceso.
 */
export async function shouldIgnoreDuplicateInicioTurn(
  rawPhone: string,
  selectionText: string,
  windowMs = 3 * 60 * 1000
): Promise<boolean> {
  const text = selectionText.trim();
  if (!text) return false;

  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return false;

  const since = new Date(Date.now() - windowMs);
  const recentInbounds = await prisma.ticketMessage.findMany({
    where: {
      ticket: { customerId: customer.id },
      direction: "INBOUND",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    select: { ticketId: true, createdAt: true, text: true },
    take: 24,
  });
  const firstSame = recentInbounds.find(
    (msg) => normTurnText(msg.text) === normTurnText(text),
  );
  if (!firstSame) return false;

  const botReplies = await prisma.ticketMessage.count({
    where: {
      ticketId: firstSame.ticketId,
      direction: "OUTBOUND",
      createdAt: { gt: firstSame.createdAt, gte: since },
    },
  });
  return botReplies > 0;
}

/** El cliente ya mandó otro texto después de que este turno arrancó: no enviar la respuesta vieja. */
export async function isTurnReplyStale(
  rawPhone: string,
  answeringText: string,
  startedAtMs: number,
): Promise<boolean> {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  if (!customer) return false;
  const latest = await prisma.ticketMessage.findFirst({
    where: {
      ticket: { customerId: customer.id },
      direction: "INBOUND",
    },
    orderBy: { createdAt: "desc" },
    select: { text: true, createdAt: true },
  });
  if (!latest?.text) return false;
  if (latest.createdAt.getTime() <= startedAtMs + 80) return false;
  return normTurnText(latest.text) !== normTurnText(answeringText);
}

/** Texto reciente del ticket del cliente (mensajes persistidos en el panel). */
export async function recentLastInboundTextForPhone(
  rawPhone: string,
  windowMs = 15 * 60 * 1000
): Promise<string> {
  try {
    const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
    if (!customer) return "";
    const since = new Date(Date.now() - windowMs);
    const msg = await prisma.ticketMessage.findFirst({
      where: {
        ticket: { customerId: customer.id },
        direction: "INBOUND",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      select: { text: true },
    });
    return msg?.text?.trim() ?? "";
  } catch {
    return "";
  }
}

function buildClassificationThread(scopedThread: string, selectionText: string): string {
  const trimmed = selectionText.trim();
  if (!trimmed) return scopedThread;
  const normTail = scopedThread
    .slice(-Math.max(trimmed.length * 2, 120))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const normMsg = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (normTail.endsWith(normMsg)) return scopedThread;
  return `${scopedThread}\n${trimmed}`.trim();
}

/**
 * Carga hilo unificado para un turno WhatsApp.
 * Usar SIEMPRE este helper en /turn (no mezclar full vs scoped ad hoc).
 */
export async function loadTurnThreadContext(
  rawPhone: string,
  selectionText = "",
  take = DEFAULT_THREAD_TAKE,
): Promise<TurnThreadContext> {
  const fullThread = await recentThreadTextForPhone(rawPhone, take);
  const scopedThread = threadTextSinceCompanySelection(fullThread);
  const classificationThread = buildClassificationThread(scopedThread, selectionText);
  return { fullThread, scopedThread, classificationThread };
}

/** Texto reciente del ticket del cliente (mensajes persistidos en el panel).
 * AISLAMIENTO: siempre keyed por rawPhone → Customer.id → Ticket del mismo cliente.
 * Nunca mezclar hilos entre números distintos. */
export async function recentThreadTextForPhone(rawPhone: string, take = DEFAULT_THREAD_TAKE): Promise<string> {
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
      take,
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
