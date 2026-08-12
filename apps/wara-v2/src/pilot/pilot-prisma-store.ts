/**
 * Persistencia Prisma del piloto V2 — fuente productiva principal.
 * JSON queda como backup opcional (dual) o solo lab.
 */
import { randomUUID } from "node:crypto";
import { createWaraV2Prisma, type PrismaClient, type Prisma } from "@wara-v2/db";
import type { PilotConversationState } from "./conversation-state.js";
import { normalizeWaraPhone } from "./wara-client.js";
import { SESSION_TTL_MS } from "./unit-fleet.js";
import { isPrismaPersistencePrimary } from "./write-gates.js";

let prisma: PrismaClient | null = null;
let initError: string | null = null;

export function getPilotPrisma(): PrismaClient | null {
  if (prisma) return prisma;
  if (!process.env.WARA_V2_DATABASE_URL?.trim()) return null;
  try {
    prisma = createWaraV2Prisma();
    return prisma;
  } catch (e) {
    initError = e instanceof Error ? e.message : "prisma_init_failed";
    return null;
  }
}

export function getPilotPrismaInitError(): string | null {
  return initError;
}

function defaultExpiresAt(now = Date.now()): Date {
  return new Date(now + SESSION_TTL_MS);
}

function channelForEnv(env: NodeJS.ProcessEnv): "shadow" | "whatsapp_pilot" | "simulator" {
  if (env.WARA_V2_SHADOW === "true") return "shadow";
  if (env.WARA_V2_PILOT_WHATSAPP === "true") return "whatsapp_pilot";
  return "simulator";
}

export async function loadPilotStateFromPrisma(
  tenantId: string,
  phone: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PilotConversationState | null> {
  const db = getPilotPrisma();
  if (!db) return null;
  const phoneE164 = normalizeWaraPhone(phone);
  const customer = await db.customer.findUnique({ where: { phoneE164 } });
  if (!customer) return null;

  const conv = await db.conversation.findFirst({
    where: {
      customerId: customer.id,
      tenantId,
      channel: channelForEnv(env),
    },
    include: { state: true },
  });
  if (!conv?.state?.pilotSnapshot) return null;

  const snap = conv.state.pilotSnapshot as PilotConversationState;
  if (snap.expiresAt && new Date(snap.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  return snap;
}

export async function savePilotStateToPrisma(
  state: PilotConversationState,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; error?: string }> {
  const db = getPilotPrisma();
  if (!db) return { ok: false, error: initError ?? "no_prisma" };

  const phoneE164 = normalizeWaraPhone(state.phone);
  // savePilotConversationState ya incrementó stateVersion en memoria; en PG persiste esa versión.
  const nextVersion = state.stateVersion;
  const expectedVersion = nextVersion - 1;

  try {
    await db.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { phoneE164 },
        create: { phoneE164, displayName: state.customerName ?? null },
        update: { displayName: state.customerName ?? undefined },
      });

      const conv = await tx.conversation.upsert({
        where: {
          customerId_channel_channelAccountId_tenantId: {
            customerId: customer.id,
            channel: channelForEnv(env),
            channelAccountId: state.tenantId,
            tenantId: state.tenantId,
          },
        },
        create: {
          customerId: customer.id,
          tenantId: state.tenantId,
          channel: channelForEnv(env),
          channelAccountId: state.tenantId,
          activeCompanyId: state.selectedContactId != null ? String(state.selectedContactId) : null,
        },
        update: {
          activeCompanyId: state.selectedContactId != null ? String(state.selectedContactId) : null,
        },
      });

      const existing = await tx.conversationState.findUnique({
        where: { conversationId: conv.id },
      });

      if (existing && existing.stateVersion !== expectedVersion) {
        throw new Error("cas_conflict");
      }

      const snapshot: PilotConversationState = {
        ...state,
        stateVersion: nextVersion,
        updatedAt: new Date().toISOString(),
      };

      await tx.conversationState.upsert({
        where: { conversationId: conv.id },
        create: {
          conversationId: conv.id,
          stateVersion: nextVersion,
          pilotSnapshot: snapshot as object,
          expiresAt: defaultExpiresAt(),
          pendingConfirmation: state.pendingConfirmation as object | undefined,
          activeUnitId: state.selectedUnit?.patente ?? null,
          activeUnitLabel: state.selectedUnit?.label ?? null,
        },
        update: {
          stateVersion: nextVersion,
          pilotSnapshot: snapshot as object,
          expiresAt: defaultExpiresAt(),
          pendingConfirmation: state.pendingConfirmation as object | undefined,
          activeUnitId: state.selectedUnit?.patente ?? null,
          activeUnitLabel: state.selectedUnit?.label ?? null,
        },
      });
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "persist_failed";
    return { ok: false, error: msg };
  }
}

export async function upsertPilotOperationRow(
  input: {
    operationId: string;
    type: "update_odometer" | "issue_certificate" | "create_maintenance" | "odoo_ticket";
    conversationId: string;
    customerId: string;
    companyId: string;
    unitId?: string | null;
    payload: Record<string, unknown>;
    payloadHash: string;
    idempotencyKey: string;
    sourceMessageId: string;
    status?: "draft" | "awaiting_confirmation" | "confirmed" | "succeeded" | "permanent_failed" | "unknown_outcome";
    externalReference?: string | null;
    executionMode?: "dry_run" | "simulation" | "shadow" | "pilot" | "production";
  },
): Promise<void> {
  const db = getPilotPrisma();
  if (!db) return;
  await db.operation.upsert({
    where: { id: input.operationId },
    create: {
      id: input.operationId,
      lineageId: input.operationId,
      operationVersion: 1,
      type: input.type,
      conversationId: input.conversationId,
      customerId: input.customerId,
      companyId: input.companyId,
      unitId: input.unitId ?? null,
      payload: input.payload as Prisma.InputJsonValue,
      payloadHash: input.payloadHash,
      idempotencyKey: input.idempotencyKey,
      sourceMessageId: input.sourceMessageId,
      status: input.status ?? "awaiting_confirmation",
      externalReference: input.externalReference ?? null,
      executionMode: input.executionMode ?? "dry_run",
    },
    update: {
      status: input.status ?? undefined,
      externalReference: input.externalReference ?? undefined,
      result: input.payload as Prisma.InputJsonValue,
    },
  });
}

export async function ensurePilotConversationIds(
  tenantId: string,
  phone: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ customerId: string; conversationId: string } | null> {
  const db = getPilotPrisma();
  if (!db) return null;
  const phoneE164 = normalizeWaraPhone(phone);
  const customer = await db.customer.upsert({
    where: { phoneE164 },
    create: { phoneE164 },
    update: {},
  });
  const conv = await db.conversation.upsert({
    where: {
      customerId_channel_channelAccountId_tenantId: {
        customerId: customer.id,
        channel: channelForEnv(env),
        channelAccountId: tenantId,
        tenantId,
      },
    },
    create: {
      customerId: customer.id,
      tenantId,
      channel: channelForEnv(env),
      channelAccountId: tenantId,
    },
    update: {},
  });
  await db.conversationState.upsert({
    where: { conversationId: conv.id },
    create: { conversationId: conv.id },
    update: {},
  });
  return { customerId: customer.id, conversationId: conv.id };
}

export function shouldUsePrismaPersistence(env: NodeJS.ProcessEnv = process.env): boolean {
  return isPrismaPersistencePrimary(env) && Boolean(getPilotPrisma());
}

export async function recordPilotMessageIngress(
  input: {
    tenantId: string;
    messageId: string;
    conversationId: string;
    payloadHash: string;
  },
): Promise<"accepted" | "duplicate"> {
  const db = getPilotPrisma();
  if (!db) return "accepted";
  try {
    await db.messageIngress.create({
      data: {
        provider: "pilot_v2",
        channelAccountId: input.tenantId,
        externalMessageId: input.messageId,
        conversationId: input.conversationId,
        inboundPayloadHash: input.payloadHash,
        ingressStatus: "accepted",
      },
    });
    return "accepted";
  } catch {
    return "duplicate";
  }
}

export function resetPilotPrismaForTests(): void {
  prisma = null;
  initError = null;
}
