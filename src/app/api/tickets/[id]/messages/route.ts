import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { summarizeConversation } from "@/lib/openai";

const messageSchema = z.object({
  text: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND", "INTERNAL_NOTE"]).default("OUTBOUND"),
  from: z.enum(["CUSTOMER", "BOT", "HUMAN"]).default("HUMAN"),
  rawPayload: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = messageSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { text, direction, from, rawPayload } = parsed.data;

  // Si es un mensaje OUTBOUND, enviarlo a BuilderBot primero
  if (direction === "OUTBOUND") {
    // Obtener el teléfono del cliente del ticket
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }

    if (!ticket.customer?.phone) {
      return NextResponse.json({ error: "Cliente sin teléfono registrado" }, { status: 400 });
    }

    // Enviar mensaje a BuilderBot → WhatsApp
    try {
      await sendWhatsAppMessage({
        number: ticket.customer.phone,
        message: text,
      });
      console.log(`[Messages] ✅ Mensaje enviado a ${ticket.customer.phone}`);
    } catch (error: any) {
      console.error(`[Messages] ❌ Error al enviar mensaje:`, error);
      return NextResponse.json({ 
        error: "No se pudo enviar el mensaje al cliente", 
        details: error.message 
      }, { status: 500 });
    }
  }

  // Guardar el mensaje en la base de datos
  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: id,
      direction,
      from,
      text,
      rawPayload: rawPayload || {},
    },
  });

  await prisma.ticket.update({
    where: { id },
    data: {
      lastMessageAt: new Date(),
      status: direction === "OUTBOUND" ? "WAITING_CUSTOMER" : undefined,
    },
  });

  // Actualizar resumen con IA después de agregar el mensaje
  try {
    const allMessages = await prisma.ticketMessage.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: "asc" },
    });

    const conversationMessages = allMessages.map((msg) => ({
      from: msg.from,
      text: msg.text,
      createdAt: msg.createdAt,
    }));

    const aiSummary = await summarizeConversation(conversationMessages);

    await prisma.ticket.update({
      where: { id },
      data: { aiSummary },
    });

    console.log(`[Messages] ✅ Resumen actualizado para ticket ${id}`);
  } catch (error: any) {
    console.error(`[Messages] ⚠️ Error al actualizar resumen:`, error.message);
    // No fallar si el resumen falla, el mensaje ya se guardó
  }

  return NextResponse.json({ message, sent: direction === "OUTBOUND" });
}
