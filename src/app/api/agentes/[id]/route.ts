import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/apiAuth";
import { hashAgentPassword } from "@/lib/agentPassword";

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(["ADMIN", "SUPPORT"]).optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").optional(),
});

function agentPublicFields(agent: {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  createdAt: Date;
  passwordHash: string | null;
  sessionActive?: boolean;
}) {
  return {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    phone: agent.phone,
    role: agent.role,
    createdAt: agent.createdAt,
    hasPassword: !!agent.passwordHash,
    sessionActive: agent.sessionActive ?? false,
  };
}

// DELETE /api/agentes/[id] - Eliminar agente
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const agente = await prisma.agentUser.findUnique({
    where: { id },
    include: {
      _count: {
        select: { tickets: true },
      },
    },
  });

  if (!agente) {
    return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  }

  if (agente._count.tickets > 0) {
    await prisma.ticket.updateMany({
      where: { assignedToUserId: id },
      data: { assignedToUserId: null },
    });
    console.log(`[Agentes] Desasignados ${agente._count.tickets} tickets del agente ${agente.name}`);
  }

  await prisma.agentUser.delete({
    where: { id },
  });

  console.log(`[Agentes] ✅ Agente eliminado: ${agente.name}`);

  return NextResponse.json({ ok: true });
}

// PATCH /api/agentes/[id] - Actualizar agente o blanquear contraseña
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = updateAgentSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Formato inválido",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const existing = await prisma.agentUser.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  }

  const { password, email, name, phone, role } = parsed.data;

  if (email && email.trim().toLowerCase() !== existing.email) {
    const dup = await prisma.agentUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (dup) {
      return NextResponse.json({ error: "Ya existe otro agente con ese email" }, { status: 400 });
    }
  }

  const agente = await prisma.agentUser.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(email !== undefined && { email: email.trim().toLowerCase() }),
      ...(phone !== undefined && { phone: phone.trim() }),
      ...(role !== undefined && { role }),
      ...(password !== undefined && { passwordHash: hashAgentPassword(password) }),
    },
  });

  if (password !== undefined) {
    console.log(`[Agentes] 🔑 Contraseña restablecida: ${agente.name}`);
  } else {
    console.log(`[Agentes] ✅ Agente actualizado: ${agente.name}`);
  }

  return NextResponse.json({ agente: agentPublicFields(agente) });
}
