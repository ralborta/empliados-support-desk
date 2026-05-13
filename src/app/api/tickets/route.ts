import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateTicketCode } from "@/lib/tickets";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";
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
            { customer: { name: { contains: q, mode: "insensitive" as const } } },
            { customer: { companyName: { contains: q, mode: "insensitive" as const } } },
            { customer: { licensePlate: { contains: q, mode: "insensitive" as const } } },
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
  /** Nombre de la persona (registro Customer) */
  customerName: z.string().optional(),
  companyName: z.string().optional(),
  licensePlate: z.string().optional(),
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

  const {
    title,
    customerPhone: rawPhone,
    customerName,
    companyName,
    licensePlate,
    contactName,
    priority,
    category,
  } = parsed.data;
  const customerPhone = normalizeWhatsAppPhone(rawPhone) || rawPhone.replace(/\s|-/g, "");

  const plate =
    licensePlate?.trim() ?
      licensePlate.replace(/\s+/g, " ").trim()
    : null;

  const customer = await prisma.customer.findUnique({
    where: { phone: customerPhone },
  });
  if (!customer) {
    return NextResponse.json(
      {
        error:
          "Ese teléfono no está registrado como cliente. Agregalo en Clientes o importá Excel antes de crear el ticket.",
      },
      { status: 400 }
    );
  }

  const hasCustomerPatch =
    customerName !== undefined || companyName !== undefined || licensePlate !== undefined;
  if (hasCustomerPatch) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        ...(customerName !== undefined && { name: customerName?.trim() || null }),
        ...(companyName !== undefined && { companyName: companyName?.trim() || null }),
        ...(licensePlate !== undefined && { licensePlate: plate }),
      },
    });
  }

  const ticket = await prisma.ticket.create({
    data: {
      code: generateTicketCode(),
      title,
      customerId: customer.id,
      contactName: contactName || customerName || companyName || "Sin nombre",
      status: "OPEN",
      priority: priority || "NORMAL",
      category: category || "TECH_SUPPORT",
      channel: "WEB",
    },
  });

  return NextResponse.json({ ticket });
}
