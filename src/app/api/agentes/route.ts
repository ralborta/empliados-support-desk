import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/apiAuth";

const createAgentSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(10, "El teléfono debe tener al menos 10 dígitos"),
  role: z.enum(["ADMIN", "SUPPORT"]).default("SUPPORT"),
});

// GET /api/agentes - Listar todos los agentes (solo admin)
export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const agentes = await prisma.agentUser.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { tickets: true },
      },
    },
  });

  return NextResponse.json({ agentes });
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

  const { name, email, phone, role } = parsed.data;

  const existing = await prisma.agentUser.findUnique({
    where: { email },
  });

  if (existing) {
    return NextResponse.json(
      {
        error: "Ya existe un agente con ese email",
      },
      { status: 400 }
    );
  }

  const agente = await prisma.agentUser.create({
    data: { name, email, phone, role },
  });

  console.log(`[Agentes] ✅ Agente creado: ${name} (${email}, ${phone})`);

  return NextResponse.json({ agente }, { status: 201 });
}
