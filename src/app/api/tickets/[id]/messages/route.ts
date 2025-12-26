import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import {
  MessageDirection,
  MessageFrom,
  TicketStatus,
} from "@/generated/prisma";

const messageSchema = z.object({
  text: z.string().min(1),
  direction: z.nativeEnum(MessageDirection).default(MessageDirection.OUTBOUND),
  from: z.nativeEnum(MessageFrom).default(MessageFrom.HUMAN),
  rawPayload: z.record(z.any()).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = messageSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { text, direction, from, rawPayload } = parsed.data;

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: params.id,
      direction,
      from,
      text,
      rawPayload: rawPayload || {},
    },
  });

  await prisma.ticket.update({
    where: { id: params.id },
    data: {
      lastMessageAt: new Date(),
      status: direction === MessageDirection.OUTBOUND ? TicketStatus.WAITING_CUSTOMER : undefined,
    },
  });

  return NextResponse.json({ message });
}
