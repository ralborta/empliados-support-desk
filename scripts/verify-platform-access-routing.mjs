#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29: "no me esta funcionando la plataforma" NO
 * se clasificaba como incidente ACCESS_PLATFORM porque `detectIncidentType` exigía la frase
 * literal "no funciona" pegada — con un pronombre en el medio ("no ME ESTÁ funcionando") ya
 * no matcheaba. El mensaje caía en la regla de fallback del router
 * (`loose_plate_or_operational_fallback`) y terminaba en el ejecutor de "unidades", que
 * respondía con el estado GPS/ignición de la última unidad activa en vez de derivar el caso
 * a un asesor humano (pedido explícito del equipo: problemas de acceso/funcionamiento de la
 * plataforma SIEMPRE deben derivarse a un asesor).
 *
 * Este test cubre tanto `detectIncidentType` (clasificación) como `classifyTurnExecutor`
 * (routing real) para asegurar que el mensaje llega al ejecutor "odoo_ticket".
 */
import assert from "node:assert";
import { detectIncidentType } from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("▶ detectIncidentType reconoce variantes conjugadas de problema de plataforma");
const platformIssues = [
  "no me esta funcionando la plataforma",
  "No me está funcionando la plataforma!",
  "no funciona la plataforma",
  "imposibilidad de ingresar a la plataforma",
  "no puedo ingresar a la plataforma",
  "no puedo entrar al sistema, dice error de usuario",
  "Funcionamiento de plataforma, imposibilidad de ingresar a la plataforma ya sea por credenciales o por inconvenientes externos.",
  "no me deja acceder a la plataforma con mi usuario",
  "la plataforma no carga nunca",
];
for (const msg of platformIssues) {
  check(`"${msg}" -> ACCESS_PLATFORM`, detectIncidentType(msg) === "ACCESS_PLATFORM");
}

console.log("\n▶ classifyTurnExecutor deriva estos mensajes a odoo_ticket (no a 'unidades')");
for (const msg of platformIssues) {
  check(`"${msg}" -> odoo_ticket`, classifyTurnExecutor(msg, "") === "odoo_ticket");
}

console.log("\n▶ No regresiona: preguntas informativas sobre usuarios/plataforma sin lenguaje de problema");
const informational = [
  "que tipos de usuarios hay",
  "como son los perfiles de usuarios",
];
for (const msg of informational) {
  check(`"${msg}" NO es ACCESS_PLATFORM`, detectIncidentType(msg) !== "ACCESS_PLATFORM");
}

console.log("\n▶ No regresiona: casos previos que ya funcionaban siguen bien");
check(
  '"no puedo entrar" sigue siendo ACCESS_PLATFORM',
  detectIncidentType("no puedo entrar a la plataforma") === "ACCESS_PLATFORM",
);
check(
  '"no funciona la plataforma" sigue siendo ACCESS_PLATFORM',
  detectIncidentType("no funciona la plataforma") === "ACCESS_PLATFORM",
);

console.log(`\n✅ ${passed} checks pasaron.`);
