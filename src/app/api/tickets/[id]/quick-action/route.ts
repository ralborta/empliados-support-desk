import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { reactivateAtilioAfterTicketClosed } from "@/lib/atilioBotPause";
import { isLabDeliverySuppressed } from "@/lib/v2Bridge/gates";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";
import {
  QUICK_ACTIONS,
  buildQuickActionCustomerMessage,
  quickActionTicketPatch,
} from "@/lib/quickActions";

const bodySchema = z.object({
  action: z.enum(QUICK_ACTIONS),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { action } = parsed.data;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { customer: true },
  });

  if (!ticket) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }

  const outboundText = buildQuickActionCustomerMessage(action);

  if (action === "internal_note") {
    await prisma.ticketMessage.create({
      data: {
        ticketId: id,
        direction: "INTERNAL_NOTE",
        from: "HUMAN",
        text: "[Acción rápida] Se requiere validación interna o seguimiento manual.",
        rawPayload: { quickAction: action },
      },
    });
    await prisma.ticket.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    });
    return NextResponse.json({ ok: true, ticketId: id, whatsappSent: false });
  }

  if (!ticket.customer?.phone) {
    return NextResponse.json({ error: "Cliente sin teléfono registrado" }, { status: 400 });
  }

  if (!outboundText) {
    return NextResponse.json({ error: "Acción sin mensaje" }, { status: 400 });
  }

  const patch = {
    ...quickActionTicketPatch(action),
    lastMessageAt: new Date(),
  };

  const updated = await prisma.ticket.update({
    where: { id },
    data: patch,
    include: { customer: true },
  });

  if (patch.status && ticket.status !== patch.status) {
    await reactivateAtilioAfterTicketClosed({
      customerId: ticket.customerId,
      ticketId: id,
      previousStatus: ticket.status,
      newStatus: patch.status,
      reason: `quick-action:${action}`,
    });
  }

  let whatsappSent = false;
  let warning: string | undefined;

  if (isLabDeliverySuppressed()) {
    warning = undefined;
  } else {
    try {
      await sendWhatsAppMessage({
        number: normalizeWhatsAppPhone(ticket.customer.phone),
        message: outboundText,
      });
      whatsappSent = true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Error al enviar";
      console.error("[quick-action] WhatsApp:", msg);
      warning = "El ticket se actualizó, pero no se pudo enviar el WhatsApp al cliente.";
    }
  }

  await prisma.ticketMessage.create({
    data: {
      ticketId: id,
      direction: "OUTBOUND",
      from: "HUMAN",
      text: outboundText,
      rawPayload: {
        quickAction: action,
        sentVia: whatsappSent ? "BUILDERBOT" : isLabDeliverySuppressed() ? "LAB" : "PENDING",
        whatsappSent,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    ticket: updated,
    whatsappSent,
    warning,
  });
}
