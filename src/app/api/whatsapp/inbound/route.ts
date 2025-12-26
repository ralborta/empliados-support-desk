import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { autoReplyActionPlan, escalationActionPlan, neutralActionPlan } from "@/lib/whatsapp/actionPlan";
import { generateTicketCode } from "@/lib/tickets";
// Using string literals instead of Prisma enums for compatibility

const inboundSchema = z.object({
  phone: z.string().min(5),
  name: z.string().optional(),
  text: z.string().min(1),
  messageId: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  auth: z.string().optional(),
});

export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Formato inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const secret = req.headers.get("x-bb-secret") || data.auth;
  if (!process.env.BUILDERBOT_WEBHOOK_SECRET || secret !== process.env.BUILDERBOT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Idempotencia por external message id
  if (data.messageId) {
    const existing = await prisma.ticketMessage.findUnique({
      where: { externalMessageId: data.messageId },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        ticketId: existing.ticketId,
        idempotent: true,
        actionPlan: neutralActionPlan(),
      });
    }
  }

  const customer = await prisma.customer.upsert({
    where: { phone: data.phone },
    update: { name: data.name ?? undefined },
    create: { phone: data.phone, name: data.name },
  });

  const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 48);
  let ticket = await prisma.ticket.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] },
      lastMessageAt: { gte: cutoff },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  if (!ticket) {
    ticket = await prisma.ticket.create({
      data: {
        code: generateTicketCode(),
        customerId: customer.id,
        title: data.text.split(" ").slice(0, 8).join(" ") || "Consulta",
        status: "OPEN",
        priority: "NORMAL",
        category: inferCategory(data.text),
        channel: "WHATSAPP",
      },
    });
  }

  const heuristics = inferPriorityAndCategory(data.text, data.metadata, ticket.priority, ticket.category);

  const actionPlan = decideNextAction({
    text: data.text,
    priority: heuristics.priority,
    metadata: data.metadata,
    previousMessages: await prisma.ticketMessage.count({ where: { ticketId: ticket.id } }),
  });

  const rawPayload = data as any;

  await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: "INBOUND",
      from: "CUSTOMER",
      text: data.text,
      rawPayload,
      externalMessageId: data.messageId,
    },
  });

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      priority: heuristics.priority,
      category: heuristics.category,
      status: actionPlan.setStatus || ticket.status,
      lastMessageAt: new Date(),
    },
  });

  await prisma.ticketEvent.create({
    data: {
      ticketId: ticket.id,
      type: actionPlan.needsHuman ? "ESCALATED" : "AUTO_REPLY",
      payload: {
        metadata: data.metadata || null,
        actionPlan,
      },
    },
  });

  return NextResponse.json({ ok: true, ticketId: ticket.id, actionPlan });
}

function inferPriorityAndCategory(
  text: string,
  metadata: Record<string, unknown> | undefined,
  currentPriority: string,
  currentCategory: string,
) {
  const lower = text.toLowerCase();
  let priority: string = currentPriority;
  let category: string = currentCategory;

  if (/(urgente|producci[óo]n|ca[ií]do|no anda|error)/.test(lower)) {
    priority = "HIGH";
  }
  if (/(amenaza|legal|fraude|cliente enojado)/.test(lower)) {
    priority = "URGENT";
  }
  if (/(factura|pago|precio)/.test(lower)) {
    category = "BILLING";
  }
  if (/(walter|emilia|silvia|oscar|max)/.test(lower)) {
    category = "TECH_SUPPORT";
  }
  if (metadata && typeof metadata["priority"] === "string") {
    const metaPriority = metadata["priority"] as string;
    if (metaPriority.toLowerCase() === "urgent") {
      priority = "URGENT";
    }
  }
  return { priority, category };
}

function inferCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/(factura|pago|precio)/.test(lower)) return "BILLING";
  if (/(walter|emilia|silvia|oscar|max)/.test(lower)) return "TECH_SUPPORT";
  return "TECH_SUPPORT";
}

function decideNextAction({
  text,
  priority,
  metadata,
  previousMessages,
}: {
  text: string;
  priority: string;
  metadata?: Record<string, unknown>;
  previousMessages: number;
}) {
  const lower = text.toLowerCase();
  const confidence = typeof metadata?.confidence === "number" ? metadata.confidence : 0;

  const shouldEscalate =
    priority === "URGENT" ||
    /(amenaza|legal|fraude|cliente enojado|escala|denuncia)/.test(lower) ||
    previousMessages >= 3;

  if (shouldEscalate) {
    return escalationActionPlan();
  }

  const typicalRequest = /(como|por que|error|no responde|webhook|env)/.test(lower);
  if (typicalRequest || confidence >= 0.7) {
    return autoReplyActionPlan([
      "Nombre del agente",
      "Canal y cliente impactado",
      "Error exacto o pantallazo",
    ]);
  }

  return neutralActionPlan();
}
