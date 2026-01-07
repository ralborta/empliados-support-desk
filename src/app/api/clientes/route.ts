import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";

const createCustomerSchema = z.object({
  phone: z.string().min(5),
  name: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  const hasTickets = searchParams.get("hasTickets"); // "true", "false", o null
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const skip = (page - 1) * limit;

  const where: any = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  // Filtrar por tickets
  if (hasTickets === "true") {
    where.tickets = { some: {} }; // Tiene al menos un ticket
  } else if (hasTickets === "false") {
    where.tickets = { none: {} }; // No tiene tickets
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        _count: {
          select: { tickets: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.customer.count({ where }),
  ]);

  return NextResponse.json({
    customers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = createCustomerSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { phone, name } = parsed.data;

  // Normalizar teléfono (quitar espacios, guiones, etc.)
  const normalizedPhone = phone.replace(/\s|-/g, "");

  try {
    const customer = await prisma.customer.create({
      data: {
        phone: normalizedPhone,
        name: name || null,
      },
      include: {
        _count: {
          select: { tickets: true },
        },
      },
    });

    return NextResponse.json({ customer });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Ya existe un cliente con este teléfono" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error al crear cliente", details: error.message }, { status: 500 });
  }
}
