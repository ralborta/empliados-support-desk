import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/apiAuth";
import { hashAgentPassword } from "@/lib/agentPassword";

const createAgentSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(["ADMIN", "SUPPORT"]).default("SUPPORT"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
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

// GET /api/agentes - Listar todos los agentes (solo admin)
export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const agentes = await prisma.agentUser.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      passwordHash: true,
      sessionActive: true,
      _count: { select: { tickets: true } },
    },
  });

  return NextResponse.json({
    agentes: agentes.map((a) => ({
      ...agentPublicFields(a),
      createdAt: a.createdAt.toISOString(),
      _count: a._count,
    })),
  });
}

// POST /api/agentes - Crear nuevo agente
export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const json = await req.json().catch(() => null);
  const parsed = createAgentSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Formato inválido",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { name, email, phone, role, password } = parsed.data;

  const existing = await prisma.agentUser.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (existing) {
    return NextResponse.json({ error: "Ya existe un agente con ese email" }, { status: 400 });
  }

  const agente = await prisma.agentUser.create({
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || "",
      role,
      passwordHash: hashAgentPassword(password),
    },
  });

  console.log(`[Agentes] ✅ Agente creado: ${name} (${email})`);

  return NextResponse.json({ agente: agentPublicFields(agente) }, { status: 201 });
}
