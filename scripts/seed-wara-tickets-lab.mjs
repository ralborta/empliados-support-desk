#!/usr/bin/env node
/**
 * Seed mínimo para wara_tickets_lab — agentes ADMIN/SUPPORT de laboratorio.
 * Idempotente. Solo ejecutar contra DATABASE_URL lab.
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("wara_tickets_lab") && process.env.WARA_V2_LAB_MODE !== "true") {
  console.error("Refusing seed: DATABASE_URL must point to wara_tickets_lab or WARA_V2_LAB_MODE=true");
  process.exit(1);
}

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function upsertAgent(input: {
  email: string;
  name: string;
  role: "ADMIN" | "SUPPORT";
  password: string;
}) {
  const existing = await prisma.agentUser.findUnique({ where: { email: input.email } });
  if (existing) {
    console.log(`agent exists: ${input.email}`);
    return existing;
  }
  return prisma.agentUser.create({
    data: {
      email: input.email,
      name: input.name,
      phone: "+5491100000000",
      role: input.role,
      passwordHash: hashPassword(input.password),
      sessionActive: input.role === "SUPPORT",
      sessionActiveAt: input.role === "SUPPORT" ? new Date() : undefined,
      lastSeenAt: input.role === "SUPPORT" ? new Date() : undefined,
      presenceStartedAt: input.role === "SUPPORT" ? new Date() : undefined,
    },
  });
}

async function main() {
  await upsertAgent({
    email: process.env.PANEL_USER_ADMIN_EMAIL ?? "admin-lab@wara.local",
    name: "Admin Lab V2",
    role: "ADMIN",
    password: process.env.PANEL_USER_ADMIN_PASSWORD ?? "LabAdmin-321",
  });
  await upsertAgent({
    email: process.env.PANEL_USER_WARA_EMAIL ?? "wara-lab@wara.local",
    name: "Asesor Lab V2",
    role: "SUPPORT",
    password: process.env.PANEL_USER_WARA_PASSWORD ?? "LabWara-321",
  });
  console.log("seed-wara-tickets-lab OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
