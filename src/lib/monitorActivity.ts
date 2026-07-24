import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export type MonitorActivityMessage = {
  id: string;
  at: string;
  direction: "INBOUND" | "OUTBOUND";
  from: string;
  textPreview: string;
  ticketCode: string;
  ticketStatus: string;
  phone: string;
  contactName: string | null;
  companyName: string | null;
};

export type MonitorActivitySummary = {
  windowMinutes: number;
  inboundCount: number;
  outboundCount: number;
  activePhones: number;
  lastInboundAt: string | null;
};

export type MonitorRecentActivity = {
  summary: MonitorActivitySummary;
  messages: MonitorActivityMessage[];
};

const DEFAULT_WINDOW_MINUTES = 180;
const MAX_MESSAGES = 35;

function previewText(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function contactLabel(name: string | null | undefined, phone: string): string | null {
  const trimmed = name?.trim();
  return trimmed || null;
}

export async function getMonitorRecentActivity(
  client: PrismaClient = prisma,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
): Promise<MonitorRecentActivity> {
  const since = new Date(Date.now() - windowMinutes * 60_000);

  const [messages, inboundCount, outboundCount, inboundPhones] = await Promise.all([
    client.ticketMessage.findMany({
      where: {
        createdAt: { gte: since },
        direction: { in: ["INBOUND", "OUTBOUND"] },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_MESSAGES,
      select: {
        id: true,
        direction: true,
        from: true,
        text: true,
        createdAt: true,
        ticket: {
          select: {
            code: true,
            status: true,
            contactName: true,
            customer: {
              select: { phone: true, name: true, companyName: true },
            },
          },
        },
      },
    }),
    client.ticketMessage.count({
      where: { createdAt: { gte: since }, direction: "INBOUND" },
    }),
    client.ticketMessage.count({
      where: { createdAt: { gte: since }, direction: "OUTBOUND", from: "BOT" },
    }),
    client.ticketMessage.findMany({
      where: { createdAt: { gte: since }, direction: "INBOUND" },
      select: {
        createdAt: true,
        ticket: { select: { customer: { select: { phone: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const phoneSet = new Set(
    inboundPhones.map((m) => m.ticket.customer.phone).filter(Boolean),
  );
  const lastInboundAt = inboundPhones[0]?.createdAt?.toISOString() ?? null;

  return {
    summary: {
      windowMinutes,
      inboundCount,
      outboundCount,
      activePhones: phoneSet.size,
      lastInboundAt,
    },
    messages: messages.map((m) => ({
      id: m.id,
      at: m.createdAt.toISOString(),
      direction: m.direction as "INBOUND" | "OUTBOUND",
      from: m.from,
      textPreview: previewText(m.text),
      ticketCode: m.ticket.code,
      ticketStatus: m.ticket.status,
      phone: m.ticket.customer.phone,
      contactName: contactLabel(m.ticket.customer.name ?? m.ticket.contactName, m.ticket.customer.phone),
      companyName: m.ticket.customer.companyName?.trim() || null,
    })),
  };
}
