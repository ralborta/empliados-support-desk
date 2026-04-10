import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { summarizeConversation } from "@/lib/openai";
import { uploadFileToBlob } from "@/lib/blob";

const messageSchema = z.object({
  text: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND", "INTERNAL_NOTE"]).default("OUTBOUND"),
  from: z.enum(["CUSTOMER", "BOT", "HUMAN"]).default("HUMAN"),
  rawPayload: z.record(z.string(), z.any()).optional(),
});

function getMimeTypeLabel(mime: string): string {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let text = "";
  let direction: "INBOUND" | "OUTBOUND" | "INTERNAL_NOTE" = "OUTBOUND";
  let from: "CUSTOMER" | "BOT" | "HUMAN" = "HUMAN";
  let rawPayload: Record<string, unknown> = {};
  let attachments: { url: string; type: string; name: string }[] = [];

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    text = (formData.get("text") as string)?.trim() || "";
    direction = (formData.get("direction") as typeof direction) || "OUTBOUND";
    from = (formData.get("from") as typeof from) || "HUMAN";
    const file = formData.get("file") as File | null;
    if (file && file.size > 0) {
      try {
        const url = await uploadFileToBlob(file);
        attachments.push({
          url,
          type: getMimeTypeLabel(file.type),
          name: file.name || "archivo",
        });
      } catch (uploadErr: any) {
        return NextResponse.json(
          { error: "No se pudo subir el archivo", details: uploadErr?.message || "Error de upload" },
          { status: 500 }
        );
      }
    }
  } else {
    const json = await req.json().catch(() => null);
    const parsed = messageSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
    }
    text = parsed.data.text;
    direction = parsed.data.direction;
    from = parsed.data.from;
    rawPayload = parsed.data.rawPayload || {};
  }

  const messageText = text.trim() || (attachments.length > 0 ? "[Archivo adjunto]" : "");
  if (!messageText) {
    return NextResponse.json({ error: "Escribe un mensaje o adjunta un archivo" }, { status: 400 });
  }

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
        message: text.trim() || " ",
        mediaUrl: attachments.length > 0 ? attachments[0].url : undefined,
      });
      console.log(`[Messages] ✅ Mensaje enviado a ${ticket.customer.phone}${attachments.length > 0 ? " (con adjunto)" : ""}`);
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
      text: messageText,
      attachments: attachments.length > 0 ? (attachments as any) : undefined,
      rawPayload: (rawPayload || {}) as any,
    },
  });

  // Si ya se guardó el mismo mensaje saliente como BOT por webhook, eliminar duplicado.
  if (direction === "OUTBOUND" && from === "HUMAN") {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    const normalized = (messageText || "").trim().replace(/\s+/g, " ");
    const botDuplicates = await prisma.ticketMessage.findMany({
      where: {
        ticketId: id,
        from: "BOT",
        direction: "OUTBOUND",
        createdAt: { gte: twoMinAgo },
        id: { not: message.id },
      },
    });
    for (const botMsg of botDuplicates) {
      const botText = (botMsg.text || "").trim().replace(/\s+/g, " ");
      if (botText === normalized || botText.includes(normalized) || normalized.includes(botText)) {
        await prisma.ticketMessage.delete({ where: { id: botMsg.id } });
        break;
      }
    }
  }

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
