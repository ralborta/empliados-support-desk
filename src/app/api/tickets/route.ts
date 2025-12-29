import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateTicketCode } from "@/lib/tickets";
import { sessionOptions, type SessionData } from "@/lib/auth";
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED" | null;
  const priority = searchParams.get("priority") as "LOW" | "NORMAL" | "HIGH" | "URGENT" | null;
  const q = searchParams.get("q") || undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            { customer: { phone: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

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
  contactName: z.string().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  category: z.enum(["TECH_SUPPORT", "BILLING", "SALES", "OTHER"]).optional(),
});

export async function POST(req: Request) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = createTicketSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { title, customerPhone, customerName, contactName, priority, category } = parsed.data;

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
      contactName: contactName || customerName || "Sin nombre",
      status: "OPEN",
      priority: priority || "NORMAL",
      category: category || "TECH_SUPPORT",
      channel: "WEB",
    },
  });

  return NextResponse.json({ ticket });
}
