import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { adminAssignTicket, assertAdvisorCanAccessTicket } from "@/lib/advisorDistribution";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const allowed = await assertAdvisorCanAccessTicket(id, session.user);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { customer: true, assignedTo: true, messages: true },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}

const updateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedToUserId: z.string().optional().nullable(),
  resolution: z.string().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const allowed = await assertAdvisorCanAccessTicket(id, session.user);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.assignedToUserId !== undefined && session.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Solo un administrador puede reasignar casos manualmente" },
      { status: 403 },
    );
  }

  const currentTicket = await prisma.ticket.findUnique({ where: { id } });
  if (!currentTicket) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }

  const { assignedToUserId, ...rest } = parsed.data;

  if (assignedToUserId !== undefined && session.user.role === "ADMIN") {
    await adminAssignTicket(id, assignedToUserId, session.user.id);
  }

  const hasOtherUpdates = Object.values(rest).some((v) => v !== undefined);
  const ticket = hasOtherUpdates
    ? await prisma.ticket.update({
        where: { id },
        data: rest,
        include: { customer: true, assignedTo: true },
      })
    : await prisma.ticket.findUnique({
        where: { id },
        include: { customer: true, assignedTo: true },
      });

  return NextResponse.json({ ticket });
}
