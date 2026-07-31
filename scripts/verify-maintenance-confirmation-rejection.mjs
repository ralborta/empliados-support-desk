#!/usr/bin/env node
/** Rechazo de mantenimiento pendiente + horómetro no cae en mantenimiento. */
import assert from "node:assert";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const {
  looksLikeMaintenanceConfirmationRejection,
  clientSupersedesMaintenanceConfirmation,
} = await import("../src/lib/waraApi.ts");
const { looksLikeOdometerIntentStart } = await import("../src/lib/wara.ts");
const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");

check("No esto no es rechazo", looksLikeMaintenanceConfirmationRejection("No esto no"));
check("no solo es rechazo", looksLikeMaintenanceConfirmationRejection("no"));
check("si no es rechazo", !looksLikeMaintenanceConfirmationRejection("si"));

const thread =
  "Voy a registrar:\nPatente: AG562SP\nTipo: Plan de mantenimiento\nPrioridad: normal\nDetalle: preventivo\n\nSi esta correcto, responde CONFIRMO para registrarlo.";
check(
  "horometro supersede mantenimiento pendiente",
  clientSupersedesMaintenanceConfirmation("Quiero cambiar el horometro de la Nissan", thread),
);

check(
  "router manda horometro a odometro",
  classifyTurnExecutor("Quiero cambiar el horometro de la Nissan", thread) === "odometro",
);

check(
  "arranque horometro reconocido",
  looksLikeOdometerIntentStart("Quiero cambiar el horometro de la Nissan"),
);

console.log(`\n✅ ${passed} checks pasaron.`);
