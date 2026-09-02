import type { Customer, PrismaClient, Ticket } from "@prisma/client";
import { autoAssignNewTicket } from "@/lib/advisorDistribution";
import { reactivateAtilioForCustomer } from "@/lib/atilioBotPause";
import { withMediaUrlMarker } from "@/lib/mediaUrlMarker";
import {
  findOpenConversationTicket,
  mergeDuplicateOpenTicketsForCustomer,
  OPEN_TICKET_THREAD_STATUSES,
} from "@/lib/ticketThreading";
import { allocateTicketCode } from "@/lib/tickets";
import { resolveCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";

/** Asunto visible en el panel para números que Wara no reconoce. */
export const UNREGISTERED_PHONE_TICKET_TITLE = "Número no registrado en Wara";

/** Asset estático en /public/guides — URL pública para mediaUrl de BuilderBot. */
export const UNREGISTERED_PHONE_GUIDE_PDF_PATH = "/guides/como-cargo-mi-numero-en-wara.pdf";

/**
 * Única respuesta al cliente cuando el número no está en Wara.
 * Incluye aviso de guía PDF (adjunto vía mediaUrl).
 */
export const UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY =
  "No encontré empresas asociadas a tu número en Wara. Te derivo con un agente.\n\nTe mando también la guía para cargar un número nuevo en la plataforma.";

/**
 * Tras la primera derivación no se reenvía texto al cliente (el asesor toma el hilo).
 * Se mantiene el export por callers que aún lo referencian; vacío = no spamear.
 */
export const UNREGISTERED_PHONE_WAITING_ADVISOR_REPLY = "";

function waraPublicAssetUrl(relativePath: string): string {
  const override = process.env.WARA_UNREGISTERED_GUIDE_PDF_URL?.trim();
  if (override && /^https?:\/\//i.test(override)) return override;
  const base =
    process.env.WARA_PUBLIC_BASE_URL?.trim() ||
    process.env.WARA_TURN_BASE_URL?.trim() ||
    (process.env.VERCEL_URL?.trim()
      ? `https://${process.env.VERCEL_URL.trim()}`
      : "https://wara.nivel41.com");
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

/** URL pública del PDF (override opcional: WARA_UNREGISTERED_GUIDE_PDF_URL). */
export function unregisteredPhoneGuidePdfUrl(): string {
  return waraPublicAssetUrl(UNREGISTERED_PHONE_GUIDE_PDF_PATH);
}

/** Texto + marcador mediaUrl para que /turn envíe el PDF por BuilderBot. */
export function buildUnregisteredPhoneFirstHandoffMessage(): string {
  return withMediaUrlMarker(
    UNREGISTERED_PHONE_FIRST_HANDOFF_REPLY,
    unregisteredPhoneGuidePdfUrl(),
  );
}

export type UnregisteredPhoneHandoffResult = {
  customer: Customer;
  ticket: Ticket;
  /** Se creó el ticket en este llamado (primera derivación). */
  isNewTicket: boolean;
  /** Primera vez: avisar al cliente. Después: false → no reenviar texto. */
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
    /**
     * Inbound (audit-only) abre ticket pero NO es la voz al cliente.
     * Si true: no marca `unregistered_phone_notice` — el aviso lo envía context/turn.
     * Bug real 2026-09-02: inbound marcaba el notice y /context quedaba en silencio.
     */
    deferCustomerNotify?: boolean;
  },
): Promise<UnregisteredPhoneHandoffResult> {
  const contactName =
    opts?.contactName?.trim() || "Contacto no registrado en Wara";
  const messageText = opts?.messageText?.trim() || "";
  const source = opts?.source ?? "unregistered_phone_handoff";
  const deferCustomerNotify = opts?.deferCustomerNotify === true;

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
  if (shouldNotifyCustomer && !deferCustomerNotify) {
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

  // Número no registrado: Atilio/Kira sigue activo solo para silenciar reenvíos;
  // el aviso al cliente es una sola vez (shouldNotifyCustomer).
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
