import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { summarizeConversation, generateResolution } from "@/lib/openai";

/**
 * POST /api/tickets/[id]/close-by-ai
 * Cierra un ticket resuelto automáticamente por IA:
 * - Resume todos los mensajes con IA
 * - Borra los mensajes temporales
 * - Marca el ticket como RESOLVED
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Obtener el ticket con todos sus mensajes
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json(
        { error: "Ticket no encontrado" },
        { status: 404 }
      );
    }

    // Si ya tiene resumen, no volver a procesar
    if (ticket.aiSummary) {
      return NextResponse.json({
        ok: true,
        message: "Ticket ya tiene resumen generado",
        ticketCode: ticket.code,
      });
    }

    console.log(`[CloseByAI] Procesando ticket ${ticket.code} con ${ticket.messages.length} mensajes`);

    // Formatear mensajes para OpenAI
    const conversationMessages = ticket.messages.map((msg) => ({
      from: msg.from,
      text: msg.text,
      createdAt: msg.createdAt,
    }));

    // Generar resumen con IA
    const aiSummary = await summarizeConversation(conversationMessages);

    // Generar conclusión
    const resolution = await generateResolution(conversationMessages, true);

    // Actualizar ticket: guardar resumen, cambiar estado, borrar mensajes
    await prisma.$transaction(async (tx) => {
      // 1. Actualizar ticket con resumen
      await tx.ticket.update({
        where: { id },
        data: {
          aiSummary,
          resolution,
          status: "RESOLVED",
          resolvedByAI: true,
        },
      });

      // 2. Crear evento de cierre
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          type: "STATUS_CHANGED",
          payload: {
            originalMessagesCount: ticket.messages.length,
            aiSummary,
            resolution,
            resolvedByAI: true,
          },
        },
      });

      // 3. Borrar todos los mensajes temporales
      await tx.ticketMessage.deleteMany({
        where: { ticketId: id },
      });

      console.log(`[CloseByAI] ✅ Ticket ${ticket.code} cerrado por IA. ${ticket.messages.length} mensajes borrados.`);
    });

    return NextResponse.json({
      ok: true,
      ticketCode: ticket.code,
      ticketId: ticket.id,
      aiSummary,
      resolution,
      messagesDeleted: ticket.messages.length,
    });
  } catch (error: any) {
    console.error("[CloseByAI] Error:", error);
    return NextResponse.json(
      { error: "Error al cerrar ticket", details: error.message },
      { status: 500 }
    );
  }
}
