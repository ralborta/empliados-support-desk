import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { allocateTicketCode } from "@/lib/tickets";
import { uploadToBlob, getFileExtension } from "@/lib/blob";
import { transcribeAudio } from "@/lib/openai";
import {
  detectIncidentType,
  detectMissingData,
  suggestPriority,
  toLegacyCategory,
  waraIncidentLabels,
} from "@/lib/wara";
import { OPEN_TICKET_THREAD_STATUSES } from "@/lib/ticketThreading";
import { autoAssignNewTicket } from "@/lib/advisorDistribution";
import { findCustomerByWhatsAppNumber, normalizeWhatsAppPhone } from "@/lib/whatsappPhone";
import { resolveCustomerByWaraPhone } from "@/lib/waraApi";
import {
  handleCustomerConversationCloseRequest,
  looksLikeCustomerConversationCloseRequest,
} from "@/lib/customerConversationClose";
import { buildWebhookMessageId } from "@/lib/webhookMessageId";
import { allowPhoneRequest } from "@/lib/phoneRateLimit";
// Using string literals instead of Prisma enums for compatibility

/** Campos para variables BuilderBot (reglas HTTP / mapeo de respuesta del webhook). */
function builderBotRegistrationFields(registered: boolean) {
  return {
    registered,
    registered_s: registered ? ("true" as const) : ("false" as const),
  };
}

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  console.log("📩 Webhook recibido de BuilderBot:", JSON.stringify(payload, null, 2));

  const eventName = typeof payload?.eventName === "string" ? payload.eventName : "";
  const incomingEvents = new Set(["message.incoming"]);
  const outgoingEvents = new Set([
    "message.outgoing",
    "message.sent",
    "message.send",
    "message_outgoing",
  ]);
  // BuilderBot envía eventos de estado (ej. status.ready) que no deben romper el webhook.
  if (!incomingEvents.has(eventName) && !outgoingEvents.has(eventName)) {
    console.log(`ℹ️ Evento no-mensaje ignorado: ${eventName || "sin eventName"}`);
    return NextResponse.json({ ok: true, message: "Evento ignorado" });
  }

  const rawData = payload?.data;
  if (!rawData || typeof rawData !== "object") {
    console.warn("⚠️ Webhook sin data objeto, ignorado");
    return NextResponse.json({ ok: true, message: "Payload sin data objeto, ignorado" });
  }
  const parsedEventName = eventName;
  const data = rawData as Record<string, unknown>;

  // Procesar mensajes entrantes y salientes
  if (incomingEvents.has(parsedEventName)) {
    // Procesar mensaje entrante del cliente
    return await processIncomingMessage({ eventName: parsedEventName, data });
  } else if (outgoingEvents.has(parsedEventName)) {
    // Procesar mensaje saliente del agente desde BuilderBot
    return await processOutgoingMessage({ eventName: parsedEventName, data });
  } else {
    console.log(`ℹ️ Evento ignorado: ${parsedEventName}`);
    return NextResponse.json({ ok: true, message: `Evento ${parsedEventName} recibido pero no procesado` });
  }
}

async function processIncomingMessage({ eventName, data }: { eventName: string; data: any }) {
  let messageText = data.body != null ? String(data.body) : "";
  if (!data.from) {
    console.warn("⚠️ message.incoming sin data.from, ignorando");
    return NextResponse.json({ ok: true, message: "Incoming sin remitente, ignorado" });
  }
  const customerPhoneRaw = String(data.from);
  const customerPhone = normalizeWhatsAppPhone(customerPhoneRaw) || customerPhoneRaw;
  if (!allowPhoneRequest(customerPhone)) {
    console.warn(`[WhatsApp] Rate limit excedido para ${customerPhone}`);
    return NextResponse.json({
      ok: true,
      rateLimited: true,
      message: "Demasiados mensajes en poco tiempo; intentá de nuevo en un minuto.",
      ...builderBotRegistrationFields(false),
    });
  }
  const customerName = data.name != null ? String(data.name) : undefined; // Nombre de WhatsApp (la persona que escribe)
  const customerResolution = await resolveCustomerByWaraPhone(prisma, customerPhoneRaw, {
    contactName: customerName,
  });
  const existingForPanel = customerResolution.customer;
  const registeredInPanel = customerResolution.registered;
  const attachments = data.attachment || [];
  const urlTempFile = data.urlTempFile; // URL temporal de BuilderBot para multimedia
  const trimmedBody = (messageText || "").trim();
  const isVoiceNote = /^_event_voice_note__/i.test(trimmedBody);
  const isAudioEvent = /^_event_audio__/i.test(trimmedBody);
  const isMediaEvent = /^_event_(document|image|video|audio)__/i.test(trimmedBody);
  if ((isMediaEvent || isVoiceNote) && attachments.length > 0) {
    messageText = "";
  }
  const isAbsoluteUrl = (u: unknown) =>
    typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://"));

  // Procesar attachments (imágenes, videos, documentos)
  let processedAttachments = (
    await Promise.all(
      attachments.map(async (att: any) => {
        const tempUrl = att.url || att;
        if (!isAbsoluteUrl(tempUrl)) return null;
        const fileType = att.mimetype || getFileTypeFromUrl(tempUrl);
        try {
          const permanentUrl = await uploadToBlob(tempUrl, `attachment-${Date.now()}.${getFileExtension(tempUrl)}`);
          return {
            url: permanentUrl,
            type: fileType,
            name: att.filename || "archivo",
          };
        } catch {
          return null;
        }
      })
    )
  ).filter((a): a is { url: string; type: string; name: string } => a != null);

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
        
        const fileType = (isVoiceNote || isAudioEvent) ? "audio" : getFileTypeFromUrl(urlTempFile);
        processedAttachments.push({
          url: permanentUrl,
          type: fileType,
          name: (isVoiceNote || isAudioEvent || fileType === "audio") ? "Nota de voz" : "Archivo multimedia",
        });
        
        console.log(`✅ Archivo subido a Blob: ${permanentUrl}`);
      } catch (error: any) {
        console.error(`❌ Error al procesar urlTempFile:`, error.message);
        // No agregar el attachment si falla
      }
    }
  }

  // Transcripción automática de nota de voz
  if ((isVoiceNote || isAudioEvent) && !messageText) {
    const audioUrl =
      (urlTempFile && isAbsoluteUrl(urlTempFile))
        ? urlTempFile
        : processedAttachments.find((a) => a.type === "audio")?.url || null;
    if (audioUrl) {
      const transcription = await transcribeAudio(audioUrl);
      messageText = transcription || "[Nota de voz - no se pudo transcribir]";
    } else {
      messageText = "[Nota de voz]";
    }
  }

  if (!messageText && processedAttachments.length === 0) {
    console.warn("⚠️ Mensaje sin texto ni attachments");
    return NextResponse.json({
      ok: true,
      message: "Mensaje vacío, ignorado",
      ...builderBotRegistrationFields(registeredInPanel),
    });
  }

  // Parsear el mensaje inicial de BuilderBot
  // Formato esperado:
  // Línea 1: Nombre de la empresa
  // Línea 2: Nombre y rol del contacto
  // Línea 3+: Problema/consulta
  const lines = messageText.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  let companyName = existingForPanel?.companyName || customerName || "Empresa desconocida";
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

  const messageId = buildWebhookMessageId({
    data: data as Record<string, unknown>,
    phone: customerPhone,
    direction: "inbound",
    body: actualMessage,
  });

  // Idempotencia por external message id (reintentos BuilderBot / stress)
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
      ...builderBotRegistrationFields(registeredInPanel),
    });
  }

  // Wara es la fuente de verdad: Customer local queda como espejo para tickets, historial y pausa del bot.
  const customer = existingForPanel;

  if (!customer) {
    if (customerResolution.testBlocked) {
      console.log(
        `[WhatsApp] ${customerPhone} fuera de WARA_TEST_ALLOWED_PHONES; ignorado (modo whitelist).`
      );
    } else {
      console.log(
        `[WhatsApp] Número no validado por Wara (${customerPhone}); no se crea cliente ni ticket.`
      );
    }
    return NextResponse.json({
      ok: true,
      message: customerResolution.testBlocked
        ? "Número fuera de la lista de prueba (WARA_TEST_ALLOWED_PHONES); mensaje ignorado"
        : "Número no validado por Wara; mensaje no asociado a un caso",
      skippedUnknownCustomer: true,
      testBlocked: customerResolution.testBlocked ?? false,
      validationSource: customerResolution.source,
      waraLookupConfigured: customerResolution.lookup?.configured ?? false,
      waraLookupError: customerResolution.lookup?.error ?? null,
      ...builderBotRegistrationFields(false),
    });
  }

  if (looksLikeCustomerConversationCloseRequest(actualMessage)) {
    const closeResult = await handleCustomerConversationCloseRequest({
      rawPhone: customerPhoneRaw,
      messageText: actualMessage,
      contactName,
      externalMessageId: messageId,
      source: "whatsapp_inbound",
    });

    return NextResponse.json({
      ok: true,
      conversationClosed: closeResult.closed,
      conversationClosed_s: closeResult.closed ? "true" : "false",
      skipResponse_s: "true",
      flowComplete_s: "true",
      ticketCode: closeResult.ticketCode,
      ticketId: closeResult.ticketId,
      message: closeResult.replyMessage,
      ...builderBotRegistrationFields(registeredInPanel),
    });
  }

  const incidentType = detectIncidentType(actualMessage);
  const { plate, missing } = detectMissingData(actualMessage, incidentType, companyName);
  const suggestedPriority = suggestPriority(actualMessage, incidentType);

  // Un solo hilo por cliente + transacción Serializable para evitar dos tickets si llegan 2 webhooks a la vez.
  const { ticket, isNewTicket } = await prisma.$transaction(
    async (tx) => {
      let t = await tx.ticket.findFirst({
        where: {
          customerId: customer.id,
          status: { in: OPEN_TICKET_THREAD_STATUSES },
        },
        orderBy: { lastMessageAt: "desc" },
      });
      if (!t) {
        const code = await allocateTicketCode(tx);
        t = await tx.ticket.create({
          data: {
            code,
            customerId: customer.id,
            contactName: contactName,
            title: `${waraIncidentLabels[incidentType]}${plate ? ` · ${plate}` : ""}`,
            status: "OPEN",
            priority: suggestedPriority,
            category: toLegacyCategory(incidentType),
            incidentType,
            channel: "WHATSAPP",
          },
        });
        console.log(`🎫 Nuevo ticket creado: ${t.code} - Empresa: ${companyName}, Contacto: ${contactName}`);
        return { ticket: t, isNewTicket: true };
      }
      console.log(`🎫 Ticket existente: ${t.code}`);
      return { ticket: t, isNewTicket: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    }
  );

  const previousMessagesCount = await prisma.ticketMessage.count({ where: { ticketId: ticket.id } });

  const shouldEscalate = decideShouldEscalate({
    text: actualMessage,
    priority: suggestedPriority,
    previousMessages: previousMessagesCount,
  });

  const rawPayload = { eventName, data };

  try {
    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        direction: "INBOUND",
        from: "CUSTOMER",
        text: actualMessage || "[Archivo adjunto]",
        attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
        rawPayload: {
          ...rawPayload,
          wara: {
            incidentType,
            incidentTypeLabel: waraIncidentLabels[incidentType],
            suggestedPriority,
            plate,
            companyName,
            missingData: missing,
          },
        },
        externalMessageId: messageId,
      },
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const dup = await prisma.ticketMessage.findFirst({
        where: { externalMessageId: messageId },
        select: { ticketId: true },
      });
      if (dup) {
        return NextResponse.json({
          ok: true,
          ticketId: dup.ticketId,
          idempotent: true,
          ...builderBotRegistrationFields(registeredInPanel),
        });
      }
    }
    throw error;
  }

  if (processedAttachments.length > 0) {
    console.log(`📎 ${processedAttachments.length} archivo(s) adjunto(s) guardado(s):`);
    processedAttachments.forEach((att, idx) => {
      console.log(`  ${idx + 1}. ${att.name} (${att.type}): ${att.url}`);
    });
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      priority: suggestedPriority,
      category: toLegacyCategory(incidentType),
      incidentType,
      status: shouldEscalate ? "IN_PROGRESS" : ticket.status,
      lastMessageAt: new Date(),
      title: `${waraIncidentLabels[incidentType]}${plate ? ` · ${plate}` : ""}`,
      aiSummary: buildOperationalSummary({
        incidentType: waraIncidentLabels[incidentType],
        plate,
        companyName,
        priority: suggestedPriority,
        missing,
      }),
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
        incidentType,
        plate,
        missingData: missing,
      },
    },
  });

  // Decidir si enviar respuesta automática (no enviar si Atilio está pausado para este cliente)
  let autoReplyMessage: string | null = null;
  let autoReplyKind: "escalation" | "new_ticket" | "ticket_on_request" | undefined;

  if (customer.botPausedAt) {
    console.log(`⏸️ Cliente ${customerPhone} con Atilio pausado; no se envía auto-respuesta`);
  } else {
    const messageLower = actualMessage.toLowerCase();
    const solicitaAgente =
      /tenponder en contacto con un agente de soporte|poner en contacto con un agente|contactar con un agente|hablar con un agente|necesito hablar con un agente/i.test(
        messageLower
      );

    const pideNumeroTicket = messageAsksForTicketCode(messageLower);

    if (shouldEscalate && solicitaAgente) {
      // La respuesta la envía /api/odoo/ticket para evitar duplicados con BBC.
    } else if (shouldEscalate) {
      autoReplyMessage = `Hola! Tu consulta ha sido escalada a nuestro equipo. Ticket: *${ticket.code}*. Te responderemos pronto.`;
      autoReplyKind = "escalation";
    } else if (pideNumeroTicket) {
      autoReplyMessage = `Tu número de caso (ticket) es *${ticket.code}*.`;
      autoReplyKind = "ticket_on_request";
    }
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
          rawPayload: {
            autoReply: true,
            ...(autoReplyKind ? { autoReplyKind } : {}),
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.error("❌ Error al enviar respuesta automática:", error);
      // No fallar el webhook si falla el envío
    }
  }

  // Código de caso al despedirse (solo si el texto parece cierre; igual que Mis Reclamos)
  const textForFarewell = (actualMessage || "").trim();
  if (!customer.botPausedAt && textForFarewell && isDespedidaWara(textForFarewell)) {
    await sendTicketCodeAtFarewellWara({
      ticketId: ticket.id,
      ticketCode: ticket.code,
      customerPhone,
      peerText: textForFarewell,
      rawExtra: { atClienteDespedida: true },
    });
  }

  try {
    const fresh = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { assignedToUserId: true },
    });
    if (isNewTicket || !fresh?.assignedToUserId) {
      await autoAssignNewTicket(ticket.id);
    }
  } catch (e) {
    console.error("[whatsapp/inbound] autoAssign:", e);
  }

  return NextResponse.json({
    ok: true,
    ticketId: ticket.id,
    ticketCode: ticket.code,
    escalated: shouldEscalate,
    autoReplySent: !!autoReplyMessage,
    autoReplyKind: autoReplyKind ?? null,
    ...builderBotRegistrationFields(true),
  });
}

async function processOutgoingMessage({ eventName, data }: { eventName: string; data: any }) {
  const messageText = data.body != null ? String(data.body) : "";
  const pick = (...vals: unknown[]) =>
    vals
      .filter((v) => typeof v === "string" && String(v).trim().length > 0)
      .map((v) => String(v).trim());
  const outgoingCandidates = [
    ...pick(
      data.to,
      data.remoteJid,
      data.key?.remoteJid,
      data.key?.participant,
      data.chatId,
      data.jid,
      data.recipient,
      data.recipientId,
      data.author,
      data.from
    ),
  ];
  const customerPhone = outgoingCandidates[0];
  const attachments = data.attachment || [];
  const urlTempFile = data.urlTempFile;
  const isAbsoluteUrl = (u: unknown) =>
    typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://"));

  if (!customerPhone) {
    console.warn("⚠️ Mensaje saliente sin destinatario");
    return NextResponse.json({ ok: true, message: "Mensaje saliente sin destinatario, ignorado" });
  }

  if (!messageText && attachments.length === 0 && !urlTempFile) {
    console.warn("⚠️ Mensaje saliente sin texto ni attachments");
    return NextResponse.json({ ok: true, message: "Mensaje saliente vacío, ignorado" });
  }

  // Procesar attachments si los hay
  let processedAttachments = (
    await Promise.all(
      attachments.map(async (att: any) => {
        const tempUrl = att.url || att;
        if (!isAbsoluteUrl(tempUrl)) return null;
        const fileType = att.mimetype || getFileTypeFromUrl(tempUrl);
        try {
          const permanentUrl = await uploadToBlob(tempUrl, `attachment-${Date.now()}.${getFileExtension(tempUrl)}`);
          return {
            url: permanentUrl,
            type: fileType,
            name: att.filename || "archivo",
          };
        } catch {
          return null;
        }
      })
    )
  ).filter((a): a is { url: string; type: string; name: string } => a != null);

  if (urlTempFile && processedAttachments.length === 0) {
    if (isAbsoluteUrl(urlTempFile)) {
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

  let chosen:
    | {
        customer: Awaited<ReturnType<typeof findCustomerByWhatsAppNumber>>;
        candidate: string;
        openTicketId?: string;
        openTicketCode?: string;
        openTicketLastMessageAt?: Date;
        anyTicketId?: string;
        anyTicketCode?: string;
        anyTicketLastMessageAt?: Date;
        score: number;
      }
    | undefined;

  for (const candidate of Array.from(new Set(outgoingCandidates))) {
    const found = await findCustomerByWhatsAppNumber(prisma, candidate);
    if (!found) continue;
    const openTicket = await prisma.ticket.findFirst({
      where: { customerId: found.id, status: { in: OPEN_TICKET_THREAD_STATUSES } },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, code: true, lastMessageAt: true },
    });
    const anyTicket = await prisma.ticket.findFirst({
      where: { customerId: found.id },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, code: true, lastMessageAt: true },
    });
    const score = openTicket ? 3 : anyTicket ? 2 : 1;
    const current = {
      customer: found,
      candidate,
      openTicketId: openTicket?.id,
      openTicketCode: openTicket?.code,
      openTicketLastMessageAt: openTicket?.lastMessageAt,
      anyTicketId: anyTicket?.id,
      anyTicketCode: anyTicket?.code,
      anyTicketLastMessageAt: anyTicket?.lastMessageAt,
      score,
    };
    if (!chosen) {
      chosen = current;
      continue;
    }
    const chosenDate =
      chosen.openTicketLastMessageAt ??
      chosen.anyTicketLastMessageAt ??
      new Date(0);
    const currentDate =
      current.openTicketLastMessageAt ??
      current.anyTicketLastMessageAt ??
      new Date(0);
    if (current.score > chosen.score || (current.score === chosen.score && currentDate > chosenDate)) {
      chosen = current;
    }
  }

  if (!chosen?.customer) {
    console.log(
      `ℹ️ Cliente no encontrado para salida. candidatos=${JSON.stringify(outgoingCandidates)}`
    );
    return NextResponse.json({
      ok: true,
      message: "Cliente no encontrado",
      outgoingCandidates,
    });
  }
  const customer = chosen.customer;

  const targetTicket =
    chosen.openTicketId
      ? {
          id: chosen.openTicketId,
          code: chosen.openTicketCode || "",
        }
      : chosen.anyTicketId
        ? {
            id: chosen.anyTicketId,
            code: chosen.anyTicketCode || "",
          }
        : null;

  if (!targetTicket) {
    console.log(
      `ℹ️ Cliente encontrado (${customer.phone}) por candidato ${chosen.candidate}, pero sin ticket asociado`
    );
    return NextResponse.json({ ok: true, message: "No hay ticket" });
  }

  // Verificar si ya existe un mensaje similar reciente (para evitar duplicados cuando se envía desde la plataforma)
  // Buscar mensajes OUTBOUND del mismo ticket con el mismo texto en los últimos 2 minutos
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  const existingMessage = await prisma.ticketMessage.findFirst({
    where: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      text: messageText || "[Archivo adjunto]",
      createdAt: {
        gte: twoMinutesAgo,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingMessage) {
    console.log(`ℹ️ Mensaje saliente ya existe (probablemente enviado desde la plataforma), ignorando duplicado`);
    return NextResponse.json({
      ok: true,
      ticketId: targetTicket.id,
      ticketCode: targetTicket.code,
      duplicate: true,
      existingMessageId: existingMessage.id,
    });
  }

  // Generar messageId estable (reintentos / stress)
  const messageId = buildWebhookMessageId({
    data: data as Record<string, unknown>,
    phone: customerPhone,
    direction: "outbound",
    body: messageText,
  });

  // Verificar idempotencia por externalMessageId
  const existingById = await prisma.ticketMessage.findFirst({
    where: { 
      externalMessageId: messageId,
    },
  });
  
  if (existingById) {
    console.log("ℹ️ Mensaje saliente duplicado por ID, ignorando");
    return NextResponse.json({
      ok: true,
      ticketId: existingById.ticketId,
      idempotent: true,
    });
  }

  const rawPayload = { eventName, data };

  // Guardar el mensaje saliente del agente desde BuilderBot
  await prisma.ticketMessage.create({
    data: {
      ticketId: targetTicket.id,
      direction: "OUTBOUND",
      from: "BOT", // Mensaje enviado por agente desde BuilderBot, se muestra como bot (verde)
      text: messageText || "[Archivo adjunto]",
      attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
      rawPayload,
      externalMessageId: messageId,
    },
  });

  // Actualizar el ticket
  await prisma.ticket.update({
    where: { id: targetTicket.id },
    data: {
      lastMessageAt: new Date(),
      status: "WAITING_CUSTOMER", // El agente envió un mensaje, ahora esperamos respuesta del cliente
    },
  });

  const phoneOut =
    normalizeWhatsAppPhone(String(customer.phone || customerPhone)) ||
    String(customerPhone);
  if (messageText && isDespedidaWara(messageText)) {
    await sendTicketCodeAtFarewellWara({
      ticketId: targetTicket.id,
      ticketCode: targetTicket.code,
      customerPhone: phoneOut,
      peerText: String(messageText || ""),
      rawExtra: { atDespedidaOutgoing: true },
      botPaused: !!customer.botPausedAt,
    });
  }

  console.log(`✅ Mensaje saliente del agente guardado en ticket ${targetTicket.code}`);

  return NextResponse.json({ 
    ok: true, 
    ticketId: targetTicket.id, 
    ticketCode: targetTicket.code,
    messageSaved: true,
  });
}
function buildOperationalSummary({
  incidentType,
  plate,
  companyName,
  priority,
  missing,
}: {
  incidentType: string;
  plate: string | null;
  companyName: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  missing: string[];
}) {
  return [
    `Motivo: ${incidentType}`,
    `Datos clave: matrícula ${plate || "sin informar"}, empresa ${companyName || "sin informar"}`,
    `Urgencia sugerida: ${priority}`,
    `Próximo paso: ${missing.length > 0 ? `solicitar ${missing.join(", ")}` : "continuar análisis interno / derivación"}`,
  ].join("\n");
}

/** El cliente pide explícitamente el código / número de caso o ticket (respuesta automática con el código). */
function messageAsksForTicketCode(messageLower: string): boolean {
  const t = messageLower.trim();
  if (t.length < 6) return false;
  return (
    /cu[aá]l\s+es\s+(mi|el)\s+(n[uú]mero\s+)?(de\s+)?(ticket|caso|reclamo)/.test(t) ||
    /cu[aá]l\s+es\s+mi\s+n[uú]mero/.test(t) ||
    /n[uú]mero\s+(de|del)\s+(ticket|caso|reclamo)/.test(t) ||
    /c[oó]digo\s+(de|del)\s+(ticket|caso|reclamo)/.test(t) ||
    /(pasame|pas[aá]me|dame|dec[ií]me)\s+(el\s+)?(n[uú]mero|ticket|c[oó]digo)(\s+de)?/.test(t) ||
    /referencia\s+(del\s+)?(caso|ticket)/.test(t) ||
    /(necesito|quiero)\s+(el|mi)\s+(n[uú]mero|c[oó]digo)\s+(de|del)?\s*(ticket|caso|reclamo)/.test(t)
  );
}

/** Despedida / cierre (cliente o bot Wara) → puede enviarse el código de caso por WhatsApp. */
function isDespedidaWara(text: string): boolean {
  if (!text || !text.trim()) return false;
  const t = text.toLowerCase().trim();
  if (/\b(chau|chao)\b|nos vemos|que estés bien|que te vaya bien|cuídate|hasta luego|hasta pronto/i.test(t)) {
    return true;
  }
  if (t.length <= 88 && /^(ok\s*)?(no\s*,?\s*)?(nada\s*)?(gracias|muchas gracias|te agradezco)[\s!.,¡¿]*$/i.test(t)) {
    return true;
  }
  if (t.length <= 48 && /^(ok\s*)?(chau|chao|nos vemos)[\s!.,¡¿]*$/i.test(t)) {
    return true;
  }
  // No usar solo "mesa de ayuda": aparece en el saludo operativo ("Atilio de Mesa de Ayuda Wara")
  // y haría que processOutgoingMessage dispare recordatorio de ticket en cada reapertura.
  return (
    /(te )?responderemos pronto|nos pondremos en contacto|equipo.*contact|un agente.*contact|agente.*revis|revisar[aá].*pronto/i.test(t) ||
    /mesa de ayuda.{0,120}(contact|comunic|deriv|atender|responder|revis)/i.test(t) ||
    /(derivad[oa]|escalad[oa]|pasad[oa]).{0,60}mesa de ayuda/i.test(t) ||
    /(gracias por (contactar|escribir|comunicarte)|cualquier cosa escrib|cualquier cosa.*escrib)/i.test(t) ||
    /(despedida|hasta luego|que tengas buen)/i.test(t) ||
    /(ticket|caso|consulta).*(revisar|revisar[aá].*pronto)/i.test(t) ||
    /(quedamos a disposici[oó]n|ante cualquier duda|saludos cordiales)/i.test(t) ||
    /(en breve|a la brevedad|nos comunicaremos|te contactaremos)/i.test(t) ||
    /(tu consulta|tu mensaje).*(recibid|registrad|derivad)/i.test(t) ||
    /(perfecto|listo|de nada|con gusto)[^.]{0,40}(gracias|saludo)/i.test(t)
  );
}

/**
 * Solo mensajes dedicados de cierre (no cuenta el auto-reply "Ticket: *…*" ni otros OUTBOUND genéricos).
 * Si usáramos "cualquier OUTBOUND que contiene el código", después del primer auto-reply nunca saldría
 * el texto "Tu número de caso…" ni el recordatorio.
 */
const dedicatedFarewellCaseCodeNeedle = "número de caso";

async function outboundAlreadySentDedicatedFarewellCaseCode(ticketId: string): Promise<boolean> {
  const found = await prisma.ticketMessage.findFirst({
    where: {
      ticketId,
      direction: "OUTBOUND",
      text: { contains: dedicatedFarewellCaseCodeNeedle, mode: Prisma.QueryMode.insensitive },
    },
  });
  return !!found;
}

async function recentOutboundDedicatedFarewellCaseCode(
  ticketId: string,
  minutesAgo: number
): Promise<boolean> {
  const since = new Date(Date.now() - minutesAgo * 60 * 1000);
  const found = await prisma.ticketMessage.findFirst({
    where: {
      ticketId,
      direction: "OUTBOUND",
      text: { contains: dedicatedFarewellCaseCodeNeedle, mode: Prisma.QueryMode.insensitive },
      createdAt: { gte: since },
    },
  });
  return !!found;
}

const firstFarewellTicketCodeMessageWara = (code: string) =>
  `Tu número de caso es *${code}*. Guardalo para cualquier consulta con Mesa de Ayuda.`;

const reminderTicketCodeMessageWara = (code: string) =>
  `Recordatorio: tu número de caso es *${code}*. Guardalo para cualquier consulta.`;

async function sendTicketCodeAtFarewellWara(opts: {
  ticketId: string;
  ticketCode: string;
  customerPhone: string;
  peerText: string;
  rawExtra: Record<string, unknown>;
  botPaused?: boolean;
}): Promise<void> {
  const { ticketId, ticketCode, customerPhone, peerText, rawExtra, botPaused } = opts;
  if (botPaused) return;

  const yaHayMensajeCierre = await outboundAlreadySentDedicatedFarewellCaseCode(ticketId);
  if (!yaHayMensajeCierre) {
    const msg = firstFarewellTicketCodeMessageWara(ticketCode);
    try {
      await sendWhatsAppMessage({ number: customerPhone, message: msg });
      await prisma.ticketMessage.create({
        data: {
          ticketId,
          direction: "OUTBOUND",
          from: "BOT",
          text: msg,
          rawPayload: {
            autoReply: true,
            autoReplyKind: "farewell_ticket_code",
            ...rawExtra,
            timestamp: new Date().toISOString(),
          },
        },
      });
      console.log(`✅ Código de caso (mensaje dedicado de cierre) enviado (${ticketCode})`);
    } catch (err) {
      console.error("❌ Error al enviar número de caso al cierre:", err);
    }
    return;
  }

  // Recordatorio: misma clase de despedida que Mis Reclamos (gracias, chau, texto de bot, etc.),
  // sin esperar solo "chau"; evitar spam si ya mandamos cierre/reminder dedicado hace muy poco.
  if (
    isDespedidaWara(peerText) &&
    !(await recentOutboundDedicatedFarewellCaseCode(ticketId, 6))
  ) {
    const reminder = reminderTicketCodeMessageWara(ticketCode);
    try {
      await sendWhatsAppMessage({ number: customerPhone, message: reminder });
      await prisma.ticketMessage.create({
        data: {
          ticketId,
          direction: "OUTBOUND",
          from: "BOT",
          text: reminder,
          rawPayload: {
            autoReply: true,
            autoReplyKind: "farewell_ticket_reminder",
            recordatorioCodigo: true,
            ...rawExtra,
            timestamp: new Date().toISOString(),
          },
        },
      });
      console.log(`✅ Recordatorio de número de caso enviado (${ticketCode})`);
    } catch (err) {
      console.error("❌ Error al enviar recordatorio de código:", err);
    }
  }
}

function looksLikeOperationalUnitQuery(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(nissan|reporte|unidad|patente|matricula|matr[ií]cula|gps|flota|interno|\d{3}-\d{3})\b/.test(
      lower,
    ) || /\b(M?\d{3}-\d{3})\b/i.test(text)
  );
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

  if (looksLikeOperationalUnitQuery(text)) {
    return false;
  }

  // Escalate if priority is URGENT
  if (priority === "URGENT") {
    return true;
  }

  // Escalate if contains critical keywords
  if (/(amenaza|legal|fraude|cliente enojado|escala|denuncia)/.test(lower)) {
    return true;
  }

  // Escalate if there are already many messages and sigue siendo reclamo abierto
  if (previousMessages >= 8) {
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
