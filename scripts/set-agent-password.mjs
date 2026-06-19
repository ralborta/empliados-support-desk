#!/usr/bin/env node
/**
 * Asigna contraseña de panel a un AgentUser existente.
 * Uso: DATABASE_URL=... node scripts/set-agent-password.mjs elapaz@waragps.com 'Wara-2141'
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

function hashAgentPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
const password = process.argv[3] ?? "";

if (!email || !password) {
  console.error("Uso: node scripts/set-agent-password.mjs <email> <password>");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const agent = await prisma.agentUser.findUnique({ where: { email } });
  if (!agent) {
    console.error(`No existe AgentUser con email ${email}`);
    process.exit(1);
  }

  await prisma.agentUser.update({
    where: { email },
    data: { passwordHash: hashAgentPassword(password) },
  });

  console.log(`Contraseña actualizada para ${agent.name} (${email}), rol ${agent.role}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
