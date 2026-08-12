import type { TicketPriority, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { autoAssignNewTicket } from "@/lib/advisorDistribution";
import { attachToOpenConversation } from "@/lib/ticketThreading";
import type { CreateV2BridgeTicketInput, CreateV2BridgeTicketResult, V2BridgePayload } from "./types";

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("+") ? phone.trim() : `+${digits}`;
}

function mapPriority(p?: string): TicketPriority {
  const u = (p ?? "NORMAL").toUpperCase();
  if (u === "URGENT") return "URGENT";
  if (u === "HIGH") return "HIGH";
  if (u === "LOW") return "LOW";
  return "NORMAL";
}

function buildBridgePayload(input: CreateV2BridgeTicketInput): V2BridgePayload {
  return {
    v2Bridge: true,
    operationId: input.operationId,
    payloadHash: input.payloadHash,
    tramite: input.tramite,
    tenantId: input.tenantId,
    phoneE164: normalizePhone(input.phoneE164),
    companyName: input.companyName ?? null,
    unit: input.unit ?? null,
    operationStatus: input.operationStatus,
    externalResult: input.externalResult ?? null,
    unknownOutcome: input.unknownOutcome ?? false,
    reconciliationRequired: input.reconciliationRequired ?? false,
    collectedData: input.collectedData ?? {},
    derivationReason: input.derivationReason ?? null,
    createdAt: new Date().toISOString(),
  };
}

export async function findTicketByV2OperationId(
  operationId: string,
): Promise<{ ticketId: string; ticketCode: string } | null> {
  const recent = await prisma.ticketMessage.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { ticket: { select: { id: true, code: true } } },
  });
  for (const msg of recent) {
    const raw = msg.rawPayload as Record<string, unknown> | null;
    const bridge = raw?.v2Bridge as V2BridgePayload | undefined;
    if (bridge?.operationId === operationId && msg.ticket) {
      return { ticketId: msg.ticket.id, ticketCode: msg.ticket.code };
    }
  }
  return null;
}

export async function createLabTicketFromV2Bridge(
  input: CreateV2BridgeTicketInput,
): Promise<CreateV2BridgeTicketResult> {
  const phone = normalizePhone(input.phoneE164);
  const existing = await findTicketByV2OperationId(input.operationId);
  if (existing) {
    return {
      ok: true,
      ticketId: existing.ticketId,
      ticketCode: existing.ticketCode,
      created: false,
      autoAssigned: false,
      idempotent: true,
    };
  }

  const bridgePayload = buildBridgePayload(input);

  let customer = await prisma.customer.findUnique({ where: { phone } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone,
        name: input.contactName,
        companyName: input.companyName ?? undefined,
      },
    });
  } else if (input.companyName && !customer.companyName) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { companyName: input.companyName },
    });
  }

  const { ticket, created } = await attachToOpenConversation(prisma, {
    customerId: customer.id,
    contactName: input.contactName,
    title: input.title,
    messageText: input.messageText,
    messagePayload: JSON.parse(JSON.stringify(bridgePayload)) as Prisma.InputJsonObject,
    priority: mapPriority(input.priority),
    category: input.category ?? "TECH_SUPPORT",
    channel: "WHATSAPP",
    incidentType: "V2_ESCALATION",
    status: "OPEN",
    aiSummary: input.derivationReason ?? undefined,
  });

  let autoAssigned = false;
  if (created) {
    autoAssigned = await autoAssignNewTicket(ticket.id);
  }

  return {
    ok: true,
    ticketId: ticket.id,
    ticketCode: ticket.code,
    created,
    autoAssigned,
    idempotent: false,
  };
}

export async function getCustomerBotPauseStatus(phoneE164: string): Promise<{
  botPaused: boolean;
  botPausedAt: string | null;
  customerId: string | null;
}> {
  const phone = normalizePhone(phoneE164);
  const customer = await prisma.customer.findUnique({ where: { phone } });
  if (!customer) {
    return { botPaused: false, botPausedAt: null, customerId: null };
  }
  return {
    botPaused: Boolean(customer.botPausedAt),
    botPausedAt: customer.botPausedAt?.toISOString() ?? null,
    customerId: customer.id,
  };
}

export function extractLatestV2OperationFromMessages(
  messages: Array<{ rawPayload: unknown; createdAt: Date }>,
): V2BridgePayload | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const raw = messages[i]?.rawPayload as Record<string, unknown> | null;
    const bridge = raw?.v2Bridge as V2BridgePayload | undefined;
    if (bridge?.v2Bridge && bridge.operationId) return bridge;
  }
  return null;
}
