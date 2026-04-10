import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/builderbot";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { customer: true, assignedTo: true, messages: true },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().optional().nullable(),
  resolution: z.string().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  // Obtener el ticket actual para comparar cambios
  const currentTicket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      customer: true,
      assignedTo: true,
    },
  });

  if (!currentTicket) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }

  // Detectar si se está asignando a un nuevo agente
  const isNewAssignment = 
    parsed.data.assignedToUserId !== undefined &&
    parsed.data.assignedToUserId !== currentTicket.assignedToUserId &&
    parsed.data.assignedToUserId !== null;

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      ...parsed.data,
    },
    include: {
      customer: true,
      assignedTo: true,
    },
  });

  // Si se asignó a un nuevo agente, enviar notificación por WhatsApp
  if (isNewAssignment && ticket.assignedTo) {
    try {
      const summary = ticket.aiSummary || "No hay resumen disponible aún.";
      const message = `🎫 *Nuevo ticket asignado*\n\n` +
        `Ticket: *${ticket.code}*\n` +
        `Cliente: ${ticket.customer?.name || ticket.customer?.phone}\n` +
        `Prioridad: ${ticket.priority}\n` +
        `Estado: ${ticket.status}\n\n` +
        `📋 *Resumen:*\n${summary}\n\n` +
        `👉 Ver en panel: https://empliados-support-desk.vercel.app/tickets/${ticket.id}`;

      await sendWhatsAppMessage({
        number: ticket.assignedTo.phone,
        message,
      });

      console.log(`[Tickets] ✅ Notificación enviada a ${ticket.assignedTo.name} (${ticket.assignedTo.phone})`);
    } catch (error: any) {
      console.error(`[Tickets] ⚠️ Error al notificar al agente:`, error.message);
      // No fallar si la notificación falla
    }
  }

  return NextResponse.json({ ticket });
}
