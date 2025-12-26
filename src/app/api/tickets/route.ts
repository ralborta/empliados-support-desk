import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateTicketCode } from "@/lib/tickets";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { TicketPriority, TicketStatus, TicketCategory } from "@/generated/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as TicketStatus | null;
  const priority = searchParams.get("priority") as TicketPriority | null;
  const q = searchParams.get("q") || undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { customer: { phone: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  } satisfies Parameters<typeof prisma.ticket.findMany>[0]["where"];

  const tickets = await prisma.ticket.findMany({
    where,
    include: { customer: true, assignedTo: true },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ tickets });
}

const createTicketSchema = z.object({
  title: z.string().min(3),
  customerPhone: z.string().min(5),
  customerName: z.string().optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  category: z.nativeEnum(TicketCategory).optional(),
});

export async function POST(req: Request) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = createTicketSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { title, customerPhone, customerName, priority, category } = parsed.data;

  const customer = await prisma.customer.upsert({
    where: { phone: customerPhone },
    update: { name: customerName ?? undefined },
    create: { phone: customerPhone, name: customerName },
  });

  const ticket = await prisma.ticket.create({
    data: {
      code: generateTicketCode(),
      title,
      customerId: customer.id,
      status: TicketStatus.OPEN,
      priority: priority || TicketPriority.NORMAL,
      category: category || TicketCategory.TECH_SUPPORT,
      channel: "WEB",
    },
  });

  return NextResponse.json({ ticket });
}
