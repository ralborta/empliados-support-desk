import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";

const messageSchema = z.object({
  text: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND", "INTERNAL_NOTE"]).default("OUTBOUND"),
  from: z.enum(["CUSTOMER", "BOT", "HUMAN"]).default("HUMAN"),
  rawPayload: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const json = await req.json().catch(() => null);
  const parsed = messageSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const { text, direction, from, rawPayload } = parsed.data;

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: id,
      direction,
      from,
      text,
      rawPayload: rawPayload || {},
    },
  });

  await prisma.ticket.update({
    where: { id },
    data: {
      lastMessageAt: new Date(),
      status: direction === "OUTBOUND" ? "WAITING_CUSTOMER" : undefined,
    },
  });

  return NextResponse.json({ message });
}
