import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import {
  pauseAtilioForCustomerDetailed,
  reactivateAtilioForCustomerDetailed,
  retryAtilioChannelSyncDetailed,
} from "@/lib/atilioBotPause";
import { ensureBuilderBotContactActive, setBotBlacklist } from "@/lib/builderbot";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

const updateCustomerSchema = z.object({
  phone: z.string().min(5).optional(),
  name: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  licensePlate: z.string().optional().nullable(),
  /** true = pausar Kira para este cliente (agente responde manual), false = reactivar */
  botPaused: z.boolean().optional(),
  /** Reintento manual del sync canal (nueva generation). */
  forceChannelSync: z.boolean().optional(),
  /**
   * Solo reaplicar mute/unmute del canal; no muta botPausedAt ni botPausedSource.
   * Evita que «Reintentar sync» convierta una pausa auto en manual.
   */
  retryChannelSync: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      _count: {
        select: { tickets: true },
      },
      tickets: {
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          priority: true,
          createdAt: true,
        },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ customer });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = updateCustomerSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const {
    phone,
    name,
    companyName,
    licensePlate,
    botPaused,
    forceChannelSync,
    retryChannelSync,
  } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (phone !== undefined) {
    updateData.phone = normalizeWhatsAppPhone(phone) || phone.replace(/\s|-/g, "");
  }
  if (name !== undefined) {
    updateData.name = name?.trim() ? name.trim() : null;
  }
  if (companyName !== undefined) {
    updateData.companyName = companyName?.trim() ? companyName.trim() : null;
  }
  if (licensePlate !== undefined) {
    const p = licensePlate?.trim();
    updateData.licensePlate = p ? p.replace(/\s+/g, " ") : null;
  }
  // botPaused lo aplica pauseAtilio / reactivateAtilio (DB + blacklist BBC).

  try {
    const hasFieldUpdates = Object.keys(updateData).length > 0;
    let customer = hasFieldUpdates
      ? await prisma.customer.update({
          where: { id },
          data: updateData,
          include: {
            _count: {
              select: { tickets: true },
            },
          },
        })
      : await prisma.customer.findUniqueOrThrow({
          where: { id },
          include: {
            _count: {
              select: { tickets: true },
            },
          },
        });

    if (retryChannelSync === true) {
      const sync = await retryAtilioChannelSyncDetailed(customer.id, prisma, {
        awaitChannelSync: false,
      });
      customer = await prisma.customer.findUniqueOrThrow({
        where: { id },
        include: {
          _count: {
            select: { tickets: true },
          },
        },
      });
      return NextResponse.json({
        customer,
        humanControl: {
          registered: sync.registered,
          botPaused: sync.localPaused,
          localPaused: sync.localPaused,
          pauseSource: sync.pauseSource,
          channelSyncOk: sync.channelSyncOk,
          muteOk: sync.muteOk,
          blacklistOk: sync.blacklistOk,
          syncStatus: sync.syncStatus,
          syncTarget: sync.syncTarget,
          syncGeneration: sync.syncGeneration,
        },
      });
    }

    if (botPaused === true || botPaused === false) {
      // Local inmediato; sync BBC vía waitUntil (no bloquea el botón).
      const sync =
        botPaused === true
          ? await pauseAtilioForCustomerDetailed(customer.id, prisma, "panel:bot-paused-toggle", {
              awaitChannelSync: false,
              forceChannelSync: forceChannelSync === true,
              pauseSource: "manual",
            })
          : await reactivateAtilioForCustomerDetailed(
              customer.id,
              prisma,
              "panel:bot-paused-toggle",
              { awaitChannelSync: false, forceChannelSync: forceChannelSync === true },
            );

      customer = await prisma.customer.findUniqueOrThrow({
        where: { id },
        include: {
          _count: {
            select: { tickets: true },
          },
        },
      });

      return NextResponse.json({
        customer,
        humanControl: {
          registered: sync.registered,
          botPaused: sync.localPaused,
          localPaused: sync.localPaused,
          pauseSource: sync.pauseSource,
          channelSyncOk: sync.channelSyncOk,
          muteOk: sync.muteOk,
          blacklistOk: sync.blacklistOk,
          syncStatus: sync.syncStatus,
          syncTarget: sync.syncTarget,
          syncGeneration: sync.syncGeneration,
        },
      });
    }

    return NextResponse.json({ customer });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Ya existe un cliente con este teléfono" }, { status: 409 });
    }
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error al actualizar cliente", details: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, phone: true, botPausedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        const tickets = await tx.ticket.findMany({
          where: { customerId: id },
          select: { id: true },
        });
        const ticketIds = tickets.map((t) => t.id);
        if (ticketIds.length > 0) {
          await tx.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
          await tx.ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
          await tx.ticketTag.deleteMany({ where: { ticketId: { in: ticketIds } } });
          await tx.agentNotification.deleteMany({ where: { ticketId: { in: ticketIds } } });
          await tx.ticket.deleteMany({ where: { customerId: id } });
        }
        await tx.customer.delete({ where: { id } });
      },
      { timeout: 120_000 }
    );

    if (existing.phone) {
      await ensureBuilderBotContactActive(existing.phone).catch((err: unknown) => {
        console.error("[Clientes] Reconciliar canal BBC al borrar:", err instanceof Error ? err.message : err);
      });
      await setBotBlacklist(existing.phone, "remove").catch((err: unknown) => {
        console.error("[Clientes] Blacklist self-hosted al borrar:", err instanceof Error ? err.message : err);
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("[Clientes] DELETE:", error);
    return NextResponse.json(
      { error: "No se pudo eliminar el cliente. Si el problema continúa, contactá al administrador.", details: msg },
      { status: 500 }
    );
  }
}
