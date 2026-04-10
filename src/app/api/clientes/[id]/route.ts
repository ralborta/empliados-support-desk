import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { setBuilderBotCloudBlacklist, setBotBlacklist } from "@/lib/builderbot";

const updateCustomerSchema = z.object({
  phone: z.string().min(5).optional(),
  name: z.string().optional(),
  /** true = pausar Atilio para este cliente (agente responde manual), false = reactivar */
  botPaused: z.boolean().optional(),
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

  const { phone, name, botPaused } = parsed.data;

  const updateData: Record<string, unknown> = {};
  if (phone !== undefined) {
    updateData.phone = phone.replace(/\s|-/g, "");
  }
  if (name !== undefined) {
    updateData.name = name || null;
  }
  if (botPaused !== undefined) {
    updateData.botPausedAt = botPaused ? new Date() : null;
  }

  try {
    const customer = await prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { tickets: true },
        },
      },
    });

    if (botPaused !== undefined && customer.phone) {
      const intent = botPaused ? "add" : "remove";
      await setBuilderBotCloudBlacklist(customer.phone, intent).catch((err: unknown) => {
        console.error("[Clientes] Blacklist Cloud:", err instanceof Error ? err.message : err);
      });
      await setBotBlacklist(customer.phone, intent).catch((err: unknown) => {
        console.error("[Clientes] Blacklist self-hosted:", err instanceof Error ? err.message : err);
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

  try {
    await prisma.customer.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ error: "Error al eliminar cliente", details: error.message }, { status: 500 });
  }
}
