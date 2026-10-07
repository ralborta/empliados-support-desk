import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { sendWhatsAppMessage } from "@/lib/builderbot";
import { extractBuilderBotOutboundMessageId } from "@/lib/builderbotSendResult";
import { summarizeConversation } from "@/lib/openai";
import { uploadFileToBlob } from "@/lib/blob";
import {
  assertAdvisorCanAccessTicket,
  claimConversationOnHumanReply,
} from "@/lib/advisorDistribution";
import { findRecentSameContentMessage } from "@/lib/outboundMessageDedup";
import { pauseAtilioForCustomerDetailed } from "@/lib/atilioBotPause";
import { statusAfterOutboundMessage } from "@/lib/ticketStatusAfterMessage";
import type { TicketStatus } from "@/lib/types";
import {
  buildPanelHumanPendingPayload,
  findPanelHumanAttemptById,
  isAmbiguousProviderSendError,
  isPanelAttemptExternalId,
  messagePresentation,
  panelAttemptAttachmentsKey,
  panelAttemptContentMatches,
  panelAttemptExternalId,
  readPanelOutboundMeta,
  updatePanelOutboundDelivery,
  type PanelDeliveryStatus,
} from "@/lib/panelHumanOutboundAttempt";

function serializeMessage(m: {
  id: string;
  from: string;
  direction: string;
  text: string;
  createdAt: Date;
  attachments: unknown;
  rawPayload?: unknown;
  externalMessageId?: string | null;
}) {
  const presentation = messagePresentation(m.rawPayload);
  return {
    id: m.id,
    from: m.from,
    direction: m.direction,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
    attachments: m.attachments,
    deliveryStatus: presentation.deliveryStatus,
    authorship: presentation.authorship,
    clientAttemptId: presentation.clientAttemptId,
    externalMessageId: m.externalMessageId ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const allowed = await assertAdvisorCanAccessTicket(id, session.user);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      from: true,
      direction: true,
      text: true,
      createdAt: true,
      attachments: true,
      rawPayload: true,
      externalMessageId: true,
    },
  });

  // Snapshot liviano para que otras sesiones vean estado/pausa/asignación sin F5.
  const ticketMeta = await prisma.ticket.findUnique({
    where: { id },
    select: {
      status: true,
      priority: true,
      assignedToUserId: true,
      assignedTo: { select: { id: true, name: true } },
      customer: {
        select: {
          botPausedAt: true,
          botChannelSyncStatus: true,
          botChannelSyncTarget: true,
          botChannelSyncGeneration: true,
        },
      },
    },
  });

  return NextResponse.json({
    messages: messages
      .filter((m) => {
        const status = readPanelOutboundMeta(m.rawPayload).deliveryStatus;
        // Fallidos no se muestran como enviados; el borrador del asesor los reintenta.
        return status !== "failed";
      })
      .map((m) => serializeMessage(m)),
    ticket: ticketMeta
      ? {
          status: ticketMeta.status,
          priority: ticketMeta.priority,
          assignedToUserId: ticketMeta.assignedToUserId,
          assignedTo: ticketMeta.assignedTo,
          botPaused: Boolean(ticketMeta.customer?.botPausedAt),
          channelSyncStatus: ticketMeta.customer?.botChannelSyncStatus ?? "idle",
          channelSyncTarget: ticketMeta.customer?.botChannelSyncTarget ?? null,
          channelSyncGeneration: ticketMeta.customer?.botChannelSyncGeneration ?? 0,
        }
      : null,
  });
}

const messageSchema = z.object({
  text: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND", "INTERNAL_NOTE"]).default("OUTBOUND"),
  from: z.enum(["CUSTOMER", "BOT", "HUMAN"]).default("HUMAN"),
  rawPayload: z.record(z.string(), z.any()).optional(),
  clientAttemptId: z.string().min(8).max(80).optional(),
});

function getMimeTypeLabel(mime: string): string {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

async function refreshTicketSummary(ticketId: string): Promise<void> {
  try {
    const allMessages = await prisma.ticketMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: "asc" },
    });
    const conversationMessages = allMessages.map((msg) => ({
      from: msg.from,
      text: msg.text,
      createdAt: msg.createdAt,
    }));
    const aiSummary = await summarizeConversation(conversationMessages);
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { aiSummary },
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Messages] ⚠️ Error al actualizar resumen:`, errMsg);
  }
}

function deliveryResponse(params: {
  message: ReturnType<typeof serializeMessage>;
  deliveryStatus: PanelDeliveryStatus;
  attemptId: string;
  error?: string;
  details?: string;
  duplicate?: boolean;
  channelSyncOk?: boolean;
  muteOk?: boolean;
  blacklistOk?: boolean;
  syncStatus?: string;
  syncTarget?: string | null;
  syncGeneration?: number;
  timing?: { dbMs: number; waMs: number; totalMs: number };
}) {
  const ok =
    params.deliveryStatus === "sent" || params.deliveryStatus === "confirmation_pending";
  return NextResponse.json(
    {
      message: params.message,
      sent: params.deliveryStatus === "sent",
      deliveryStatus: params.deliveryStatus,
      clientAttemptId: params.attemptId,
      duplicate: params.duplicate === true,
      ...(params.error ? { error: params.error } : {}),
      ...(params.details ? { details: params.details } : {}),
      ...(params.timing ? { timing: params.timing } : {}),
      ...(params.channelSyncOk !== undefined
        ? {
            humanControl: {
              registered: true,
              botPaused: true,
              localPaused: true,
              channelSyncOk: params.channelSyncOk,
              muteOk: params.muteOk ?? params.channelSyncOk,
              blacklistOk: params.blacklistOk ?? params.channelSyncOk,
              syncStatus: params.syncStatus ?? (params.channelSyncOk ? "synced" : "pending"),
              syncTarget: params.syncTarget ?? "paused",
              syncGeneration: params.syncGeneration ?? 0,
            },
          }
        : {}),
    },
    { status: ok ? (params.deliveryStatus === "confirmation_pending" ? 202 : 200) : 422 },
  );
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
  let clientAttemptId = "";

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    text = (formData.get("text") as string)?.trim() || "";
    direction = (formData.get("direction") as typeof direction) || "OUTBOUND";
    from = (formData.get("from") as typeof from) || "HUMAN";
    clientAttemptId = String(formData.get("clientAttemptId") || "").trim();
    const file = formData.get("file") as File | null;
    if (file && file.size > 0) {
      try {
        const url = await uploadFileToBlob(file);
        attachments.push({
          url,
          type: getMimeTypeLabel(file.type),
          name: file.name || "archivo",
        });
      } catch (uploadErr: unknown) {
        const details = uploadErr instanceof Error ? uploadErr.message : "Error de upload";
        return NextResponse.json(
          { error: "No se pudo subir el archivo", details },
          { status: 500 },
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
    clientAttemptId = String(parsed.data.clientAttemptId || "").trim();
  }

  const messageText = text.trim() || (attachments.length > 0 ? "[Archivo adjunto]" : "");
  if (!messageText) {
    return NextResponse.json({ error: "Escribe un mensaje o adjunta un archivo" }, { status: 400 });
  }

  const allowed = await assertAdvisorCanAccessTicket(id, session.user);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // --- HUMAN OUTBOUND: intento pendiente → proveedor → estado ---
  if (direction === "OUTBOUND" && from === "HUMAN") {
    if (!clientAttemptId) clientAttemptId = randomUUID();

    const existingAttempt = await findPanelHumanAttemptById(prisma, {
      ticketId: id,
      clientAttemptId,
    });

    if (existingAttempt) {
      const meta = readPanelOutboundMeta(existingAttempt.rawPayload);
      const nextAttachmentsKey = panelAttemptAttachmentsKey(attachments);
      const storedAttachmentsKey =
        meta.attemptAttachmentsKey ??
        panelAttemptAttachmentsKey(
          (existingAttempt.attachments as Array<{ url?: string; type?: string; name?: string }> | null) ||
            [],
        );
      // Contenido distinto (texto o adjuntos) = otro intento.
      if (
        !panelAttemptContentMatches({
          storedText: meta.attemptText ?? existingAttempt.text,
          storedAttachmentsKey,
          nextText: messageText,
          nextAttachmentsKey,
        })
      ) {
        return NextResponse.json(
          {
            error:
              "El borrador o el adjunto cambió respecto del intento pendiente. Se necesita un nuevo envío.",
            code: "ATTEMPT_CONTENT_MISMATCH",
            clientAttemptId,
          },
          { status: 409 },
        );
      }

      const alreadyConfirmed = !isPanelAttemptExternalId(existingAttempt.externalMessageId);

      if (alreadyConfirmed || meta.deliveryStatus === "sent") {
        if (meta.deliveryStatus !== "sent") {
          await updatePanelOutboundDelivery(prisma, {
            messageId: existingAttempt.id,
            deliveryStatus: "sent",
          });
        }
        const fresh = await prisma.ticketMessage.findUniqueOrThrow({
          where: { id: existingAttempt.id },
        });
        return deliveryResponse({
          message: serializeMessage(fresh),
          deliveryStatus: "sent",
          attemptId: clientAttemptId,
          duplicate: true,
        });
      }

      // Fallo definitivo primero (no confundir con confirmation_pending por bbcCalledAt).
      if (meta.deliveryStatus === "failed") {
        await updatePanelOutboundDelivery(prisma, {
          messageId: existingAttempt.id,
          deliveryStatus: "pending",
          patch: {
            lastRetryAt: new Date().toISOString(),
            bbcCalledAt: null,
          },
        });
      } else if (meta.deliveryStatus === "confirmation_pending") {
        // Reintento del mismo intento pendiente de confirmación: no volver a llamar al proveedor.
        return deliveryResponse({
          message: serializeMessage(existingAttempt),
          deliveryStatus: "confirmation_pending",
          attemptId: clientAttemptId,
          duplicate: true,
        });
      } else if (meta.deliveryStatus === "pending" && meta.bbcCalledAt) {
        // Ya se llamó a BBC y aún no hay veredicto → confirmación pendiente.
        return deliveryResponse({
          message: serializeMessage(existingAttempt),
          deliveryStatus: "confirmation_pending",
          attemptId: clientAttemptId,
          duplicate: true,
        });
      }
      // pending sin bbcCalledAt: continuar y llamar al proveedor.
    }

    // Dedup por contenido solo como respaldo corto y solo si ya está confirmado/pendiente.
    if (!existingAttempt) {
      const recentHuman = await findRecentSameContentMessage(prisma, {
        ticketId: id,
        direction: "OUTBOUND",
        from: "HUMAN",
        text: messageText,
        windowMs: 8_000,
      });
      if (recentHuman) {
        const recentMeta = readPanelOutboundMeta(recentHuman.rawPayload);
        if (
          recentMeta.deliveryStatus === "sent" ||
          recentMeta.deliveryStatus === "confirmation_pending" ||
          !isPanelAttemptExternalId(recentHuman.externalMessageId)
        ) {
          return deliveryResponse({
            message: serializeMessage(recentHuman),
            deliveryStatus:
              recentMeta.deliveryStatus === "confirmation_pending"
                ? "confirmation_pending"
                : "sent",
            attemptId: recentMeta.clientAttemptId || clientAttemptId,
            duplicate: true,
          });
        }
      }
    }

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

    const ticketForStatus = {
      status: ticket.status as TicketStatus,
      customerId: ticket.customerId,
    };

    let message =
      existingAttempt ||
      (await prisma.ticketMessage.create({
        data: {
          ticketId: id,
          direction: "OUTBOUND",
          from: "HUMAN",
          text: messageText,
          attachments: attachments.length > 0 ? (attachments as object) : undefined,
          externalMessageId: panelAttemptExternalId(clientAttemptId),
          rawPayload: buildPanelHumanPendingPayload({
            clientAttemptId,
            advisorUserId: session.user.id,
            attemptText: messageText,
            attemptAttachmentsKey: panelAttemptAttachmentsKey(attachments),
          }),
        },
      }));

    // Takeover local inmediato; sync BBC con generation + waitUntil (no bloquea WA).
    const tOutbound0 = Date.now();
    const pauseSync = await pauseAtilioForCustomerDetailed(
      ticketForStatus.customerId,
      prisma,
      "human_outbound_takeover",
      { awaitChannelSync: false, skipChannelIfAlreadyPaused: true },
    ).catch((e) => {
      console.error("[Messages] pauseAtilio takeover:", e);
      return {
        registered: false,
        channelSyncOk: false,
        muteOk: false,
        blacklistOk: false,
        syncStatus: "error" as const,
        syncTarget: "paused" as const,
        syncGeneration: 0,
        localPaused: true,
      };
    });
    const dbMs = Date.now() - tOutbound0;
    void claimConversationOnHumanReply(id, session.user.id).catch((e) =>
      console.error("[Messages] claimConversation:", e),
    );

    const labSuppress =
      process.env.WARA_V2_LAB_MODE === "true" || process.env.DELIVERY_ENABLED === "false";

    let deliveryStatus: PanelDeliveryStatus = "pending";
    let sendError: string | undefined;
    const tWa0 = Date.now();

    if (labSuppress) {
      console.log(`[Messages] LAB: mensaje humano simulado (sin WhatsApp) → ${ticket.customer.phone}`);
      deliveryStatus = "sent";
      await updatePanelOutboundDelivery(prisma, {
        messageId: message.id,
        deliveryStatus: "sent",
        patch: { labSuppress: true, bbcCalledAt: new Date().toISOString() },
      });
    } else {
      await updatePanelOutboundDelivery(prisma, {
        messageId: message.id,
        deliveryStatus: "pending",
        patch: { bbcCalledAt: new Date().toISOString() },
      });
      try {
        const providerRes = await sendWhatsAppMessage({
          number: ticket.customer.phone,
          message: text.trim() || " ",
          mediaUrl: attachments.length > 0 ? attachments[0].url : undefined,
        });
        const providerMessageId = extractBuilderBotOutboundMessageId(providerRes);
        console.log(
          `[Messages] ✅ Mensaje enviado a ${ticket.customer.phone}${attachments.length > 0 ? " (con adjunto)" : ""}`,
        );

        // ¿El webhook ya confirmó mientras esperábamos?
        const after = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
        if (!isPanelAttemptExternalId(after.externalMessageId)) {
          deliveryStatus = "sent";
          await updatePanelOutboundDelivery(prisma, {
            messageId: message.id,
            deliveryStatus: "sent",
            patch: {
              providerHttpOk: true,
              ...(providerMessageId ? { providerMessageId } : {}),
            },
            ...(providerMessageId ? { externalMessageId: providerMessageId } : {}),
          });
        } else {
          deliveryStatus = "sent";
          await updatePanelOutboundDelivery(prisma, {
            messageId: message.id,
            deliveryStatus: "sent",
            patch: {
              providerHttpOk: true,
              ...(providerMessageId ? { providerMessageId } : {}),
            },
            ...(providerMessageId ? { externalMessageId: providerMessageId } : {}),
          });
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[Messages] ❌ Error al enviar mensaje:`, error);
        sendError = errMsg;

        const after = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
        if (!isPanelAttemptExternalId(after.externalMessageId)) {
          // Webhook confirmó a pesar del error HTTP → éxito.
          deliveryStatus = "sent";
          await updatePanelOutboundDelivery(prisma, {
            messageId: message.id,
            deliveryStatus: "sent",
            patch: { providerHttpErrorButWebhookConfirmed: true, lastError: errMsg },
          });
        } else if (isAmbiguousProviderSendError(error)) {
          deliveryStatus = "confirmation_pending";
          await updatePanelOutboundDelivery(prisma, {
            messageId: message.id,
            deliveryStatus: "confirmation_pending",
            patch: { lastError: errMsg, ambiguousError: true },
          });
        } else {
          deliveryStatus = "failed";
          await updatePanelOutboundDelivery(prisma, {
            messageId: message.id,
            deliveryStatus: "failed",
            patch: { lastError: errMsg },
          });
        }
      }
    }

    // Solo limpia ecos BOT "sin confirmar" con texto exacto (no inclusión / no borrar envíos legítimos).
    if (deliveryStatus === "sent" || deliveryStatus === "confirmation_pending") {
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
        const botMeta = readPanelOutboundMeta(botMsg.rawPayload);
        if (botMeta.authorship !== "unconfirmed") continue;
        const botText = (botMsg.text || "").trim().replace(/\s+/g, " ");
        if (botText === normalized) {
          await prisma.ticketMessage.delete({ where: { id: botMsg.id } });
          break;
        }
      }

      await prisma.ticket.update({
        where: { id },
        data: {
          lastMessageAt: new Date(),
          status: statusAfterOutboundMessage(ticketForStatus.status),
        },
      });
      void refreshTicketSummary(id);
    }

    message = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
    const waMs = Date.now() - tWa0;
    const totalMs = Date.now() - tOutbound0;
    console.log(
      `[panelOutboundTiming] ticket=${id} dbMs=${dbMs} waMs=${waMs} totalMs=${totalMs} delivery=${deliveryStatus} syncStatus=${pauseSync.syncStatus}`,
    );
    return deliveryResponse({
      message: serializeMessage(message),
      deliveryStatus,
      attemptId: clientAttemptId,
      error:
        deliveryStatus === "failed"
          ? "No se pudo enviar el mensaje al cliente"
          : deliveryStatus === "confirmation_pending"
            ? "Envío aceptado con confirmación pendiente"
            : undefined,
      details: sendError,
      channelSyncOk: pauseSync.channelSyncOk,
      muteOk: pauseSync.muteOk,
      blacklistOk: pauseSync.blacklistOk,
      syncStatus: pauseSync.syncStatus,
      syncTarget: pauseSync.syncTarget,
      syncGeneration: pauseSync.syncGeneration,
      timing: { dbMs, waMs, totalMs },
    });
  }

  // --- INTERNAL_NOTE / otros caminos no-human-outbound ---
  let ticketForStatus: { status: TicketStatus; customerId: string } | null = null;
  if (direction === "OUTBOUND") {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { customer: true },
    });
    ticketForStatus = ticket
      ? { status: ticket.status as TicketStatus, customerId: ticket.customerId }
      : null;

    if (!ticket) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }
    if (!ticket.customer?.phone) {
      return NextResponse.json({ error: "Cliente sin teléfono registrado" }, { status: 400 });
    }

    const labSuppress =
      process.env.WARA_V2_LAB_MODE === "true" || process.env.DELIVERY_ENABLED === "false";
    if (!labSuppress) {
      try {
        await sendWhatsAppMessage({
          number: ticket.customer.phone,
          message: text.trim() || " ",
          mediaUrl: attachments.length > 0 ? attachments[0].url : undefined,
        });
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
          { error: "No se pudo enviar el mensaje al cliente", details: errMsg },
          { status: 500 },
        );
      }
    }
  }

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: id,
      direction,
      from,
      text: messageText,
      attachments: attachments.length > 0 ? (attachments as object) : undefined,
      rawPayload: (rawPayload || {}) as object,
    },
  });

  await prisma.ticket.update({
    where: { id },
    data: {
      lastMessageAt: new Date(),
      ...(direction === "OUTBOUND" && ticketForStatus
        ? { status: statusAfterOutboundMessage(ticketForStatus.status) }
        : {}),
    },
  });

  void refreshTicketSummary(id);
  return NextResponse.json({ message: serializeMessage(message), sent: direction === "OUTBOUND" });
}
