import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";

const createAgentSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["ADMIN", "SUPPORT"]).default("SUPPORT"),
});

// GET /api/agentes - Listar todos los agentes
export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = createAgentSchema.safeParse(json);
  
  if (!parsed.success) {
    return NextResponse.json({ 
      error: "Formato inválido", 
      details: parsed.error.flatten() 
    }, { status: 400 });
  }

  const { name, email, role } = parsed.data;

  // Verificar si ya existe
  const existing = await prisma.agentUser.findUnique({
    where: { email },
  });

  if (existing) {
    return NextResponse.json({ 
      error: "Ya existe un agente con ese email" 
    }, { status: 400 });
  }

  const agente = await prisma.agentUser.create({
    data: { name, email, role },
  });

  console.log(`[Agentes] ✅ Agente creado: ${name} (${email})`);

  return NextResponse.json({ agente }, { status: 201 });
}
