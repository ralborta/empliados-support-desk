import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { generateTicketCode } from "@/lib/tickets";
import { uploadToBlob, getFileExtension } from "@/lib/blob";
// Using string literals instead of Prisma enums for compatibility

// Schema para el formato de BuilderBot.cloud
const builderbotWebhookSchema = z.object({
  eventName: z.string(),
  data: z.object({
    body: z.string().optional(),
    name: z.string().optional(),
    from: z.string(),
    attachment: z.array(z.any()).optional(),
    urlTempFile: z.string().optional(), // URL temporal para archivos multimedia
    projectId: z.string().optional(),
  }),
});

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  console.log("📩 Webhook recibido de BuilderBot:", JSON.stringify(payload, null, 2));

  const parsed = builderbotWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("❌ Formato inválido:", parsed.error.flatten());
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { eventName, data } = parsed.data;

  // Procesar mensajes entrantes y salientes
  if (eventName === "message.incoming") {
    // Procesar mensaje entrante del cliente
    return await processIncomingMessage(parsed.data);
  } else if (eventName === "message.outgoing") {
    // Procesar mensaje saliente del agente desde BuilderBot
    return await processOutgoingMessage(parsed.data);
  } else {
    console.log(`ℹ️ Evento ignorado: ${eventName}`);
    return NextResponse.json({ ok: true, message: `Evento ${eventName} recibido pero no procesado` });
  }
}

async function processIncomingMessage({ eventName, data }: { eventName: string; data: any }) {

  const messageText = data.body || "";
  const customerPhone = data.from;
  const customerName = data.name; // Nombre de WhatsApp (la persona que escribe)
  const attachments = data.attachment || [];
  const urlTempFile = data.urlTempFile; // URL temporal de BuilderBot para multimedia

  // Procesar attachments (imágenes, videos, documentos)
  let processedAttachments = await Promise.all(
    attachments.map(async (att: any) => {
      const tempUrl = att.url || att;
      const fileType = att.mimetype || getFileTypeFromUrl(tempUrl);
      
      // Subir a Vercel Blob para persistencia
      const permanentUrl = await uploadToBlob(tempUrl, `attachment-${Date.now()}.${getFileExtension(tempUrl)}`);
      
      return {
        url: permanentUrl,
        type: fileType,
        name: att.filename || "archivo",
      };
    })
  );

  // Si viene urlTempFile pero no attachments, agregar el archivo temporal
  if (urlTempFile && processedAttachments.length === 0) {
    console.log(`📎 Archivo temporal detectado: ${urlTempFile}`);
    
    // Validar que sea URL absoluta
    if (!urlTempFile.startsWith("http://") && !urlTempFile.startsWith("https://")) {
      console.error(`❌ urlTempFile no es URL absoluta: ${urlTempFile}`);
      // No agregar si no es absoluta
    } else {
      try {
        // Subir a Vercel Blob
        const permanentUrl = await uploadToBlob(urlTempFile, `media-${Date.now()}.${getFileExtension(urlTempFile)}`);
        
        processedAttachments.push({
          url: permanentUrl,
          type: getFileTypeFromUrl(urlTempFile),
          name: "Archivo multimedia",
        });
        
        console.log(`✅ Archivo subido a Blob: ${permanentUrl}`);
      } catch (error: any) {
        console.error(`❌ Error al procesar urlTempFile:`, error.message);
        // No agregar el attachment si falla
      }
    }
  }

  if (!messageText && processedAttachments.length === 0) {
    console.warn("⚠️ Mensaje sin texto ni attachments");
    return NextResponse.json({ ok: true, message: "Mensaje vacío, ignorado" });
  }

  // Parsear el mensaje inicial de BuilderBot
  // Formato esperado:
  // Línea 1: Nombre de la empresa
  // Línea 2: Nombre y rol del contacto
  // Línea 3+: Problema/consulta
  const lines = messageText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  let companyName = customerName || "Empresa desconocida";
  let contactName = customerName || "Sin nombre";
  let actualMessage = messageText;

  // Si el mensaje tiene al menos 3 líneas, asumimos que es el formato inicial del bot
  if (lines.length >= 3) {
    companyName = lines[0]; // Línea 1 = Empresa
    contactName = lines[1]; // Línea 2 = Contacto
    actualMessage = lines.slice(2).join("\n"); // Línea 3+ = Problema
    console.log(`📊 Parseado: Empresa="${companyName}", Contacto="${contactName}", Mensaje="${actualMessage}"`);
  } else {
    // Si no tiene el formato esperado, usar todo como mensaje
    console.log(`ℹ️ Mensaje no sigue formato inicial, usando texto completo`);
    contactName = customerName || "Sin nombre";
  }

  // Generar un messageId único basado en el contenido y timestamp
  const messageId = `${customerPhone}-${Date.now()}`;

  // Idempotencia por external message id
  const existing = await prisma.ticketMessage.findFirst({
    where: { 
      externalMessageId: messageId,
    },
  });
  
  if (existing) {
    console.log("ℹ️ Mensaje duplicado, ignorando");
    return NextResponse.json({
      ok: true,
      ticketId: existing.ticketId,
      idempotent: true,
    });
  }

  // Upsert customer: el nombre es la EMPRESA
  const customer = await prisma.customer.upsert({
    where: { phone: customerPhone },
    update: { name: companyName },
    create: { phone: customerPhone, name: companyName },
  });

  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 48);
  let ticket = await prisma.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] },
      lastMessageAt: { gte: cutoff },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const isNewTicket = !ticket;

  if (!ticket) {
    ticket = await prisma.ticket.create({
      data: {
        code: generateTicketCode(),
        customerId: customer.id,
        contactName: contactName,
        title: actualMessage.split(" ").slice(0, 8).join(" ") || "Consulta",
        status: "OPEN",
        priority: "NORMAL",
        category: inferCategory(actualMessage) as "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER",
        channel: "WHATSAPP",
      },
    });
    console.log(`🎫 Nuevo ticket creado: ${ticket.code} - Empresa: ${companyName}, Contacto: ${contactName}`);
  } else {
    console.log(`🎫 Ticket existente: ${ticket.code}`);
  }

  const heuristics = inferPriorityAndCategory(actualMessage, undefined, ticket.priority, ticket.category);

  const previousMessagesCount = await prisma.ticketMessage.count({ where: { ticketId: ticket.id } });

  const shouldEscalate = decideShouldEscalate({
    text: actualMessage,
    priority: heuristics.priority,
    previousMessages: previousMessagesCount,
  });

  const rawPayload = { eventName, data };

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: actualMessage || "[Archivo adjunto]",
      attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
      rawPayload,
      externalMessageId: messageId,
    },
  });

  if (processedAttachments.length > 0) {
    console.log(`📎 ${processedAttachments.length} archivo(s) adjunto(s) guardado(s):`);
    processedAttachments.forEach((att, idx) => {
      console.log(`  ${idx + 1}. ${att.name} (${att.type}): ${att.url}`);
    });
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      priority: heuristics.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT",
      category: heuristics.category as "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER",
      status: shouldEscalate ? "IN_PROGRESS" : ticket.status,
      lastMessageAt: new Date(),
    },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      type: shouldEscalate ? "ESCALATED" : "AUTO_REPLY",
      payload: {
        message: actualMessage,
        company: companyName,
        contact: contactName,
        escalated: shouldEscalate,
      },
    },
  });

  // Decidir si enviar respuesta automática
  let autoReplyMessage: string | null = null;

  // Verificar si el mensaje solicita contacto con agente de soporte
  const messageLower = actualMessage.toLowerCase();
  const solicitaAgente = /tenponder en contacto con un agente de soporte|poner en contacto con un agente|contactar con un agente|hablar con un agente|necesito hablar con un agente/i.test(messageLower);

  if (shouldEscalate && solicitaAgente) {
    autoReplyMessage = `Hola! Tu consulta ha sido escalada a nuestro equipo. Ticket: *${ticket.code}*. Te responderemos pronto.`;
  } else if (isNewTicket) {
    autoReplyMessage = `Hola! Hemos recibido tu mensaje. Ticket: *${ticket.code}*. Un agente lo revisará pronto.`;
  }

  // Enviar respuesta automática si corresponde
  if (autoReplyMessage) {
    try {
      await sendWhatsAppMessage({
        number: customerPhone,
        message: autoReplyMessage,
      });
      console.log(`✅ Respuesta automática enviada a ${customerPhone}`);

      // Registrar la respuesta automática en el ticket
      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          direction: "OUTBOUND",
          from: "BOT",
          text: autoReplyMessage,
          rawPayload: { autoReply: true, timestamp: new Date().toISOString() },
        },
      });
    } catch (error) {
      console.error("❌ Error al enviar respuesta automática:", error);
      // No fallar el webhook si falla el envío
    }
  }

  return NextResponse.json({ 
    ok: true, 
    ticketId: ticket.id, 
    ticketCode: ticket.code,
    escalated: shouldEscalate,
    autoReplySent: !!autoReplyMessage,
  });
}

async function processOutgoingMessage({ eventName, data }: { eventName: string; data: any }) {
  const messageText = data.body || "";
  // En mensajes salientes, el destinatario puede estar en 'to', 'remoteJid', o 'key.remoteJid'
  const customerPhone = data.to || data.remoteJid || data.key?.remoteJid || data.from;
  const attachments = data.attachment || [];
  const urlTempFile = data.urlTempFile;

  if (!customerPhone) {
    console.warn("⚠️ Mensaje saliente sin destinatario");
    return NextResponse.json({ ok: true, message: "Mensaje saliente sin destinatario, ignorado" });
  }

  if (!messageText && attachments.length === 0 && !urlTempFile) {
    console.warn("⚠️ Mensaje saliente sin texto ni attachments");
    return NextResponse.json({ ok: true, message: "Mensaje saliente vacío, ignorado" });
  }

  // Procesar attachments si los hay
  let processedAttachments = await Promise.all(
    attachments.map(async (att: any) => {
      const tempUrl = att.url || att;
      const fileType = att.mimetype || getFileTypeFromUrl(tempUrl);
      
      const permanentUrl = await uploadToBlob(tempUrl, `attachment-${Date.now()}.${getFileExtension(tempUrl)}`);
      
      return {
        url: permanentUrl,
        type: fileType,
        name: att.filename || "archivo",
      };
    })
  );

  if (urlTempFile && processedAttachments.length === 0) {
    if (urlTempFile.startsWith("http://") || urlTempFile.startsWith("https://")) {
      try {
        const permanentUrl = await uploadToBlob(urlTempFile, `media-${Date.now()}.${getFileExtension(urlTempFile)}`);
        processedAttachments.push({
          url: permanentUrl,
          type: getFileTypeFromUrl(urlTempFile),
          name: "Archivo multimedia",
        });
      } catch (error: any) {
        console.error(`❌ Error al procesar urlTempFile:`, error.message);
      }
    }
  }

  // Buscar el ticket activo para este cliente
  const customer = await prisma.customer.findUnique({
    where: { phone: customerPhone },
  });

  if (!customer) {
    console.log(`ℹ️ Cliente no encontrado para ${customerPhone}, ignorando mensaje saliente`);
    return NextResponse.json({ ok: true, message: "Cliente no encontrado" });
  }

  // Buscar ticket activo (últimas 48 horas)
  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 48);
  const ticket = await prisma.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] },
      lastMessageAt: { gte: cutoff },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  if (!ticket) {
    console.log(`ℹ️ No hay ticket activo para ${customerPhone}, ignorando mensaje saliente`);
    return NextResponse.json({ ok: true, message: "No hay ticket activo" });
  }

  // Generar messageId único
  const messageId = `outgoing-${customerPhone}-${Date.now()}`;

  // Verificar idempotencia
  const existing = await prisma.ticketMessage.findFirst({
    where: { 
      externalMessageId: messageId,
    },
  });
  
  if (existing) {
    console.log("ℹ️ Mensaje saliente duplicado, ignorando");
    return NextResponse.json({
      ok: true,
      ticketId: existing.ticketId,
      idempotent: true,
    });
  }

  const rawPayload = { eventName, data };

  // Guardar el mensaje saliente del agente
  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "OUTBOUND",
      from: "HUMAN", // Mensaje enviado por agente desde BuilderBot
      text: messageText || "[Archivo adjunto]",
      attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
      rawPayload,
      externalMessageId: messageId,
    },
  });

  // Actualizar el ticket
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      lastMessageAt: new Date(),
      status: "WAITING_CUSTOMER", // El agente envió un mensaje, ahora esperamos respuesta del cliente
    },
  });

  console.log(`✅ Mensaje saliente del agente guardado en ticket ${ticket.code}`);

  return NextResponse.json({ 
    ok: true, 
    ticketId: ticket.id, 
    ticketCode: ticket.code,
    messageSaved: true,
  });
}

function inferPriorityAndCategory(
  text: string,
  metadata: Record<string, unknown> | undefined,
  currentPriority: string,
  currentCategory: string,
) {
  const lower = text.toLowerCase();
  let priority: string = currentPriority;
  let category: string = currentCategory;

  if (/(urgente|producci[óo]n|ca[ií]do|no anda|error)/.test(lower)) {
    priority = "HIGH";
  }
  if (/(amenaza|legal|fraude|cliente enojado)/.test(lower)) {
    priority = "URGENT";
  }
  if (/(factura|pago|precio)/.test(lower)) {
    category = "BILLING";
  }
  if (/(walter|emilia|silvia|oscar|max)/.test(lower)) {
    category = "TECH_SUPPORT";
  }
  if (metadata && typeof metadata["priority"] === "string") {
    const metaPriority = metadata["priority"] as string;
    if (metaPriority.toLowerCase() === "urgent") {
      priority = "URGENT";
    }
  }
  return { priority, category };
}

function inferCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/(factura|pago|precio)/.test(lower)) return "BILLING";
  if (/(walter|emilia|silvia|oscar|max)/.test(lower)) return "TECH_SUPPORT";
  return "TECH_SUPPORT";
}

function decideShouldEscalate({
  text,
  priority,
  previousMessages,
}: {
  text: string;
  priority: string;
  previousMessages: number;
}): boolean {
  const lower = text.toLowerCase();

  // Escalate if priority is URGENT
  if (priority === "URGENT") {
    return true;
  }

  // Escalate if contains critical keywords
  if (/(amenaza|legal|fraude|cliente enojado|escala|denuncia)/.test(lower)) {
    return true;
  }

  // Escalate if there are already 3+ messages in the ticket
  if (previousMessages >= 3) {
    return true;
  }

  return false;
}

function getFileTypeFromUrl(url: string): string {
  if (!url) return "unknown";
  const lowerUrl = url.toLowerCase();
  if (/(jpg|jpeg|png|gif|webp)/.test(lowerUrl)) return "image";
  if (/(mp4|mov|avi|webm)/.test(lowerUrl)) return "video";
  if (/(pdf)/.test(lowerUrl)) return "pdf";
  if (/(mp3|wav|ogg|m4a)/.test(lowerUrl)) return "audio";
  if (/(doc|docx|xls|xlsx|ppt|pptx)/.test(lowerUrl)) return "document";
  return "file";
}
