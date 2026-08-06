import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { looksLikeCustomerConversationCloseRequest } from "@/lib/customerConversationClose";
import {
  buildCaseRegisteredWithoutOdooRefReply,
  findCustomerVisibleOdooCaseRef,
  formatCustomerOdooCaseRefForWhatsApp,
} from "@/lib/customerOdooCaseRef";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

/** Persiste respuesta del bot en el ticket del cliente (panel / historial). */
export async function persistCustomerBotReply(
  rawPhone: string,
  text: string,
  payload: Record<string, unknown>,
  client: PrismaClient = prisma,
): Promise<void> {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) return;
  const targetTicket =
    (await client.ticket.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
    })) ??
    (await client.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    }));
  if (!targetTicket) return;
  const recent = await client.ticketMessage.findFirst({
    where: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
  });
  if (recent) return;
  await client.ticketMessage.create({
    data: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT",
      text: message,
      rawPayload: payload as never,
    },
  });
}

/** Persiste mensaje entrante del cliente (panel / hilo de clasificación). */
export async function persistCustomerInbound(
  rawPhone: string,
  text: string,
  payload: Record<string, unknown>,
  client: PrismaClient = prisma,
): Promise<void> {
  const message = text?.trim();
  if (!message) return;
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) return;
  const targetTicket =
    (await client.ticket.findFirst({
      where: { customerId: customer.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
    })) ??
    (await client.ticket.findFirst({
      where: { customerId: customer.id },
      orderBy: { lastMessageAt: "desc" },
    }));
  if (!targetTicket) return;
  const recent = await client.ticketMessage.findFirst({
    where: {
      ticketId: targetTicket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: message,
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
  });
  if (recent) return;
  await client.ticketMessage.create({
    data: {
      ticketId: targetTicket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: message,
      rawPayload: payload as never,
    },
  });
  await client.ticket.update({
    where: { id: targetTicket.id },
    data: { lastMessageAt: new Date() },
  });
}

function normInquiryText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Cliente pregunta si tiene un caso/ticket abierto (no pide asesor ni patente). */
export function looksLikeOpenCaseStatusInquiry(text: string | undefined | null): boolean {
  const t = normInquiryText(text ?? "");
  if (!t || t.length > 160) return false;

  if (looksLikeCustomerConversationCloseRequest(text)) return false;

  return (
    /\b(tengo|hay|tiene|tienen|existe)\s+(un\s+)?(caso|ticket|reclamo|consulta)\s+(abierto|activo|pendiente|en curso)\b/.test(
      t,
    ) ||
    /\b(caso|ticket|reclamo|consulta)\s+(abierto|activo|pendiente|en curso)\b/.test(t) ||
    /\btengo\s+algo\s+(abierto|pendiente|en curso)\b/.test(t) ||
    /\b(cual|cu[aá]l)\s+es\s+(mi|el)\s+(caso|ticket|reclamo)\s+(abierto|activo)\b/.test(t)
  );
}

/**
 * Cliente pregunta cuándo / en cuánto le dan resultado del análisis, novedades o demora.
 * Bug real 2026-08-06: "cuando me das respuesta del resultado del analisis?" — Atilio
 * respondía como si él mismo analizara y avisara, sin aclarar que el especialista
 * de Atención al cliente es quien contacta con los tiempos.
 */
export function looksLikeCaseResolutionEtaInquiry(text: string | undefined | null): boolean {
  const t = normInquiryText(text ?? "");
  if (!t || t.length > 180) return false;
  if (looksLikeCustomerConversationCloseRequest(text)) return false;
  if (looksLikeOpenCaseStatusInquiry(text)) return false;

  const asksWhen =
    /\b(cuando|cu[aá]ndo|en cuanto|en cu[aá]nto|cuanto tarda|cu[aá]nto tarda|cuanto demora|cu[aá]nto demora|para cuando|para cu[aá]ndo|en que momento|en qu[eé] momento)\b/.test(
      t,
    ) ||
    /\b(me (dan|das|avisan|avisas|responden|contestan)|van a (dar|avisar|responder|contestar))\b/.test(t);

  const asksResult =
    /\b(resultado|analisis|an[aá]lisis|novedad(es)?|resolucion|resoluci[oó]n|respuesta|avance|demora|tiempo(s)?|plazo|eta)\b/.test(
      t,
    ) ||
    /\b(del caso|del reclamo|del ticket|de la revision|de la revisi[oó]n)\b/.test(t);

  if (asksWhen && asksResult) return true;

  // Variantes cortas naturales sin "cuando" explícito.
  if (
    /\b(hay|tienen|tenes|ten[eé]s)\s+(alguna\s+)?(novedad|respuesta|avance)\b/.test(t) ||
    /\b(alguna\s+)?(novedad|respuesta)\s+(del|de\s+el)\s+(caso|analisis|an[aá]lisis|reclamo)\b/.test(t) ||
    /\bme\s+(podes|pod[eé]s|pueden)\s+(decir|avisar)\s+(cuando|cu[aá]ndo|algo)\b/.test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * Respuesta a pedidos de tiempos/resultado: no inventa SLA; deriva la expectativa
 * al especialista de Atención al cliente (WhatsApp).
 */
export async function buildCaseResolutionEtaReply(
  rawPhone: string,
  client: PrismaClient = prisma,
): Promise<string> {
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) {
    return (
      "El seguimiento del análisis lo hace Atención al cliente. " +
      "En breve un especialista te escribe por este chat con los tiempos y el avance. " +
      "Si tu número no quedó bien identificado, volvé a escribirme."
    );
  }

  const openTicket = await client.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });

  if (!openTicket) {
    return (
      "Ahora mismo no veo un caso abierto con este número para darte tiempos. " +
      "Si ya abriste uno, pasame el número de caso o contame de nuevo el tema y lo revisamos."
    );
  }

  const odooRef = await findCustomerVisibleOdooCaseRef(client, {
    customerId: customer.id,
    ticketId: openTicket.id,
  });
  const caseBit = odooRef
    ? `El caso *${formatCustomerOdooCaseRefForWhatsApp(odooRef)}* ya está en Atención al cliente. `
    : "Tu consulta ya quedó en Atención al cliente. ";

  return (
    caseBit +
    "En breve un especialista te va a contactar por este mismo chat con los tiempos y el avance concreto. " +
    "Desde acá no manejo esas demoras exactas; ellos te las confirman."
  );
}

export async function buildOpenCaseStatusReply(
  rawPhone: string,
  client: PrismaClient = prisma,
): Promise<string> {
  const customer = await findCustomerByWhatsAppNumber(client, rawPhone);
  if (!customer) {
    return "No pude identificar tu número. Si necesitás ayuda, escribime de nuevo.";
  }

  const openTicket = await client.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: OPEN_TICKET_THREAD_STATUSES },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });

  if (openTicket) {
    const odooRef = await findCustomerVisibleOdooCaseRef(client, {
      customerId: customer.id,
      ticketId: openTicket.id,
    });
    if (odooRef) {
      const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
      return `Sí, tenés el caso *${display}* abierto. Puedo seguir ayudándote por este chat con consultas sobre ese tema o cosas nuevas. Si querés cerrarlo, escribí "cerrar caso" o "resolver conversación".`;
    }
    return "Sí, tenés un caso abierto en Atención al cliente. Puedo seguir ayudándote por este chat. Si querés cerrarlo, escribí \"cerrar caso\" o \"resolver conversación\".";
  }

  const lastClosed = await client.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ["RESOLVED", "CLOSED"] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (lastClosed) {
    const odooRef = await findCustomerVisibleOdooCaseRef(client, {
      customerId: customer.id,
      ticketId: lastClosed.id,
    });
    if (odooRef) {
      const display = formatCustomerOdooCaseRefForWhatsApp(odooRef);
      return `No tenés casos abiertos. El último (*${display}*) ya está cerrado. ¿En qué te puedo ayudar?`;
    }
    return "No tenés casos abiertos. ¿En qué te puedo ayudar?";
  }

  return "No tenés casos registrados con este número. Contame en qué te puedo ayudar.";
}
