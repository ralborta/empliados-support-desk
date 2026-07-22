#!/usr/bin/env node
/**
 * Verifica el estado explícito de trámite pendiente (Customer.pendingAction) contra la DB real.
 * Crea y borra un Customer descartable con teléfono de prueba — no toca clientes reales.
 *
 * Requiere DATABASE_URL (sourcear .env.production.local o el env que corresponda).
 */
import { PrismaClient } from "@prisma/client";
import { setPendingAction, getPendingAction, clearPendingAction } from "../src/lib/pendingAction.ts";

const prisma = new PrismaClient();
const TEST_PHONE = "5490000000999"; // número ficticio, no existe en Wara

let failures = 0;
function assert(cond, label) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

async function main() {
  console.log("— Estado explícito pendingAction (DB real) —");

  await prisma.customer.deleteMany({ where: { phone: TEST_PHONE } });
  await prisma.customer.create({ data: { phone: TEST_PHONE, name: "Test PendingAction" } });

  try {
    const empty = await getPendingAction(prisma, TEST_PHONE);
    assert(empty === null, "sin trámite pendiente al crear el cliente");

    await setPendingAction(prisma, TEST_PHONE, "odometro", {
      summary: "Voy a registrar: Patente AD427MC, Odómetro 1000 km",
      payload: { patente: "AD427MC", odometro: 1000 },
    });
    const set = await getPendingAction(prisma, TEST_PHONE);
    assert(set?.type === "odometro", "setPendingAction guarda tipo odometro");
    assert(set?.payload?.patente === "AD427MC", "payload conserva la patente");

    await setPendingAction(prisma, TEST_PHONE, "certificados", {
      summary: "Voy a generar el certificado...",
      payload: { plate: "AD427MC" },
    });
    const overwritten = await getPendingAction(prisma, TEST_PHONE);
    assert(overwritten?.type === "certificados", "un trámite nuevo pisa al anterior (único pendiente por cliente)");

    await clearPendingAction(prisma, TEST_PHONE);
    const cleared = await getPendingAction(prisma, TEST_PHONE);
    assert(cleared === null, "clearPendingAction deja el estado en null");

    // TTL: un registro viejo (creado hace > 45 min) debe ignorarse.
    const stalePayload = {
      type: "mantenimiento",
      summary: "viejo",
      payload: {},
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    await prisma.customer.update({
      where: { phone: TEST_PHONE },
      data: { pendingAction: stalePayload },
    });
    const stale = await getPendingAction(prisma, TEST_PHONE);
    assert(stale === null, "trámite pendiente vencido (TTL 45min) se ignora");

    // Teléfono inexistente: no debe explotar, solo no-op.
    await setPendingAction(prisma, "5490000000000", "odometro", { payload: {} });
    const missing = await getPendingAction(prisma, "5490000000000");
    assert(missing === null, "cliente inexistente no rompe (no-op silencioso)");
  } finally {
    await prisma.customer.deleteMany({ where: { phone: TEST_PHONE } });
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} fallo(s) en verify-pending-action-state`);
    process.exit(1);
  }
  console.log("\n✓ Estado explícito pendingAction OK (DB real)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
