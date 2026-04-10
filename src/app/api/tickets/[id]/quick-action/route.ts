import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/builderbot";

const bodySchema = z.object({
  action: z.enum([
    "request_data",
    "in_analysis",
    "derive",
    "resolve",
    "close",
    "internal_note",
  ]),
});

function buildCustomerMessage(
  action: z.infer<typeof bodySchema>["action"],
  code: string
): string | null {
  switch (action) {
    case "request_data":
      return `Hola, para avanzar con tu ticket *${code}* necesitamos más datos o detalle del problema. ¿Podés enviarnos lo que falte o aclarar el caso? Gracias.`;
    case "in_analysis":
      return `Tu consulta *${code}* está en análisis. Te mantendremos informados.`;
    case "derive":
      return `Derivamos tu caso *${code}* al área correspondiente. Te contactarán a la brevedad.`;
    case "resolve":
      return `Hemos registrado tu caso *${code}* como resuelto. Si necesitás algo más, escribinos.`;
    case "close":
      return `Cerramos el ticket *${code}*. Gracias por contactarnos.`;
    case "internal_note":
      return null;
    default:
      return null;
  }
}

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

  const outboundText = buildCustomerMessage(action, ticket.code);

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
    return NextResponse.json({ ok: true, ticketId: id });
  }

  if (!ticket.customer?.phone) {
    return NextResponse.json({ error: "Cliente sin teléfono registrado" }, { status: 400 });
  }

  if (!outboundText) {
    return NextResponse.json({ error: "Acción sin mensaje" }, { status: 400 });
  }

  try {
    await sendWhatsAppMessage({
      number: ticket.customer.phone,
      message: outboundText,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error al enviar";
    console.error("[quick-action] WhatsApp:", msg);
    return NextResponse.json({ error: "No se pudo enviar el mensaje al cliente", details: msg }, { status: 500 });
  }

  const patch: {
    status?: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
    resolution?: string | null;
    lastMessageAt: Date;
  } = { lastMessageAt: new Date() };

  switch (action) {
    case "request_data":
      patch.status = "WAITING_CUSTOMER";
      break;
    case "in_analysis":
      patch.status = "IN_PROGRESS";
      break;
    case "derive":
      patch.status = "IN_PROGRESS";
      patch.resolution = "BACKOFFICE_DERIVED";
      break;
    case "resolve":
      patch.status = "RESOLVED";
      patch.resolution = "CHAT_RESOLVED";
      break;
    case "close":
      patch.status = "CLOSED";
      patch.resolution = "CLOSED_NO_ACTION";
      break;
    default:
      break;
  }

  const updated = await prisma.ticket.update({
    where: { id },
    data: patch,
    include: { customer: true },
  });

  await prisma.ticketMessage.create({
    data: {
      ticketId: id,
      direction: "OUTBOUND",
      from: "HUMAN",
      text: outboundText,
      rawPayload: { quickAction: action, sentVia: "BUILDERBOT" },
    },
  });

  return NextResponse.json({ ok: true, ticket: updated });
}
