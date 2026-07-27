#!/usr/bin/env node
/**
 * Aislamiento de hilo por número WhatsApp — cada cliente solo ve SU conversación.
 * El historial NUNCA debe mezclarse entre números distintos.
 *
 * Contrato de arquitectura:
 * - Customer.phone (normalizado) es la clave de aislamiento.
 * - recentThreadTextForPhone / loadTurnThreadContext filtran por customerId.
 * - pendingAction, activeUnit, sesión Wara: todo keyed por phone en Customer.
 * - NO se usa history de BuilderBot en body (rompe JSON y no garantiza aislamiento).
 */
import { normalizeWhatsAppPhone } from "../src/lib/whatsappPhone.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Mismo contacto, distintos formatos → un solo identificador —");
const canonical = "5491123456789";
assert(
  normalizeWhatsAppPhone("5491123456789") === canonical,
  "solo dígitos",
);
assert(
  normalizeWhatsAppPhone("+54 9 11 2345-6789") === canonical,
  "con + y espacios",
);
assert(
  normalizeWhatsAppPhone("5491123456789@s.whatsapp.net") === canonical,
  "JID WhatsApp",
);

console.log("\n— Números distintos → identificadores distintos (sin mezclar hilos) —");
assert(
  normalizeWhatsAppPhone("5491123456789") !== normalizeWhatsAppPhone("5491187654321"),
  "dos clientes no comparten phone normalizado",
);

console.log("\n— Carga de hilo siempre recibe rawPhone (grep estático) —");
const threadLoader = fs.readFileSync(path.join(root, "src/lib/conversationThread.ts"), "utf8");
assert(
  /export async function recentThreadTextForPhone\(rawPhone/.test(threadLoader),
  "recentThreadTextForPhone(rawPhone)",
);
assert(
  /findCustomerByWhatsAppNumber\(prisma, rawPhone\)/.test(threadLoader),
  "busca Customer por rawPhone antes de leer mensajes",
);
assert(
  /where: \{ customerId: customer\.id \}/.test(threadLoader),
  "mensajes filtrados por customerId",
);

const odometroRoute = fs.readFileSync(
  path.join(root, "src/app/api/wara/odometro-horometro/route.ts"),
  "utf8",
);
assert(
  !/parsed\.data\.history|body\.history/.test(odometroRoute),
  "odómetro NO usa history de BBC en body",
);
assert(
  /recentThreadText\(rawPhone\)/.test(odometroRoute),
  "odómetro reconstruye hilo desde DB por rawPhone",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Aislamiento de hilo por número OK");
