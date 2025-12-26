import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { TicketPriority, TicketStatus } from "@/generated/prisma";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: { customer: true, assignedTo: true, messages: true },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}

const updateSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToUserId: z.string().optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const ticket = await prisma.ticket.update({
    where: { id: params.id },
    data: {
      ...parsed.data,
    },
  });

  return NextResponse.json({ ticket });
}
