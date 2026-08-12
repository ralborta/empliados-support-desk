/**
 * Idempotencia mínima de escrituras odómetro/horómetro V1.
 * Evita doble llamada a WARA por reenvío o segundo CONFIRMO sobre la misma operación.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizeWhatsAppPhone } from "@/lib/whatsappPhone";

const GUARD_TTL_MS = 45 * 60 * 1000;

export type OdometerWriteGuard = {
  fingerprint: string;
  writtenAt: string;
  confirmMessageIds: string[];
  patente: string;
  odometro?: number;
  horometro?: number;
  fecha: string;
};

type GuardEnvelope = {
  odometerWriteGuard?: OdometerWriteGuard;
};

export function fingerprintOdometerWrite(input: {
  patente: string;
  fecha: string;
  odometro?: number;
  horometro?: number;
}): string {
  const canonical = JSON.stringify({
    plate: input.patente.replace(/\s+/g, "").toUpperCase(),
    fecha: input.fecha.trim(),
    o: typeof input.odometro === "number" ? input.odometro : null,
    h: typeof input.horometro === "number" ? input.horometro : null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

async function readGuard(prisma: PrismaClient, phone: string): Promise<OdometerWriteGuard | null> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;
  const customer = await prisma.customer
    .findUnique({ where: { phone: normalized }, select: { sessionNotebook: true } })
    .catch(() => null);
  const raw = customer?.sessionNotebook;
  if (!raw || typeof raw !== "object") return null;
  const guard = (raw as GuardEnvelope).odometerWriteGuard;
  if (!guard?.fingerprint || !guard.writtenAt) return null;
  const age = Date.now() - Date.parse(guard.writtenAt);
  if (!Number.isFinite(age) || age > GUARD_TTL_MS) return null;
  return guard;
}

async function writeGuard(prisma: PrismaClient, phone: string, guard: OdometerWriteGuard): Promise<void> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  const customer = await prisma.customer
    .findUnique({ where: { phone: normalized }, select: { sessionNotebook: true } })
    .catch(() => null);
  const prev =
    customer?.sessionNotebook && typeof customer.sessionNotebook === "object"
      ? (customer.sessionNotebook as Record<string, unknown>)
      : {};
  await prisma.customer
    .update({
      where: { phone: normalized },
      data: {
        sessionNotebook: {
          ...prev,
          odometerWriteGuard: guard,
        },
      },
    })
    .catch(() => undefined);
}

export type OdometerWriteGuardCheck =
  | { kind: "proceed" }
  | { kind: "duplicate"; message: string; guard: OdometerWriteGuard };

export async function checkOdometerWriteGuard(
  prisma: PrismaClient,
  phone: string,
  input: {
    patente: string;
    fecha: string;
    odometro?: number;
    horometro?: number;
    confirmMessageId?: string | null;
  },
): Promise<OdometerWriteGuardCheck> {
  const fingerprint = fingerprintOdometerWrite(input);
  const existing = await readGuard(prisma, phone);
  if (!existing) return { kind: "proceed" };
  if (existing.fingerprint !== fingerprint) return { kind: "proceed" };

  if (input.confirmMessageId && existing.confirmMessageIds.includes(input.confirmMessageId)) {
    return {
      kind: "duplicate",
      guard: existing,
      message: "Este CONFIRMO ya fue procesado. No repetí el registro en WARA.",
    };
  }

  return {
    kind: "duplicate",
    guard: existing,
    message: "Esa operación de odómetro/horómetro ya fue registrada. No repetí el registro en WARA.",
  };
}

export async function recordOdometerWriteGuard(
  prisma: PrismaClient,
  phone: string,
  input: {
    patente: string;
    fecha: string;
    odometro?: number;
    horometro?: number;
    confirmMessageId?: string | null;
  },
): Promise<void> {
  const fingerprint = fingerprintOdometerWrite(input);
  const existing = await readGuard(prisma, phone);
  const confirmMessageIds = new Set(existing?.confirmMessageIds ?? []);
  if (input.confirmMessageId) confirmMessageIds.add(input.confirmMessageId);

  await writeGuard(prisma, phone, {
    fingerprint,
    writtenAt: new Date().toISOString(),
    confirmMessageIds: [...confirmMessageIds],
    patente: input.patente,
    odometro: input.odometro,
    horometro: input.horometro,
    fecha: input.fecha,
  });
}
