#!/usr/bin/env node
/**
 * Auditoría de seguridad (2026-07-23) sobre los fixes de continuidad de contexto
 * (odómetro y certificados con "unidad mencionada"). El pedido explícito del cliente
 * fue: "hacelo bien, OJO no me hagas parche donde se arregla una cosa y se jode otra".
 *
 * Esta suite reproduce, con la flota real de ejemplo, los casos donde el fix de HOY
 * (reactivar el fallback de "reusar la última patente del hilo", antes muerto por un
 * bug de `??` sobre string vacío) podía filtrarse a mensajes que NO deberían heredar
 * una patente vieja de otro trámite, y confirma que siguen sin contaminarse.
 *
 * Bug real encontrado y corregido en esta misma auditoría: un saludo suelto como
 * "hola, buenas" en un hilo con una patente mencionada antes por otro trámite
 * terminaba resolviendo esa patente vieja, porque extractSearchTerms() mezclaba el
 * texto del hilo completo en cuanto el mensaje actual no aportaba ningún término
 * propio (aunque no fuera una referencia vaga a una unidad). Se corrigió para que
 * solo mezcle el hilo cuando hay una referencia vaga explícita o algún término propio.
 *
 * Bug real encontrado y corregido en esta misma auditoría: una corrección explícita de
 * dos patentes en un mismo mensaje ("no es la OST 223, es la AD 427 MC") tomaba la
 * RECHAZADA en vez de la CORREGIDA, porque tanto detectLoosePlate como
 * extractPlateCorrectionHint devuelven la PRIMERA coincidencia de patrón, no la última.
 * Se agregó detectAllPlates() + preferencia explícita por la última patente completa
 * mencionada cuando el mensaje es reconocido como una corrección de patente.
 *
 * Uso: npx tsx scripts/verify-context-continuity-safety.mjs
 */
import { resolveUnitQuery } from "../src/lib/waraUnitIntent.ts";

let failed = 0;

async function assertResolution(label, args, expect) {
  const r = await resolveUnitQuery(args);
  const plateOk = expect.plate === undefined || r.plate === expect.plate;
  const intentOk = expect.intent === undefined || r.intent === expect.intent;
  const noPlateOk = !expect.noPlate || !r.plate;
  if (plateOk && intentOk && noPlateOk) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(
      `  ✗ ${label} -> intent=${r.intent} plate=${r.plate ?? "-"} (esperado intent=${expect.intent ?? "*"} plate=${expect.plate ?? (expect.noPlate ? "ninguna" : "*")})`,
    );
  }
}

const fleet = [
  { movil_id: 1, patente: "AG 562 SP", unidad: "NISSAN 2404" },
  { movil_id: 2, patente: "OST 223", unidad: "CAMION 1" },
  { movil_id: 3, patente: "AD 427 MC", unidad: "FORD RANGER" },
];

const threadWithOldPlate = [
  "Necesito el certificado de la OST 223",
  "Listo, te paso el certificado de OST 223.",
].join("\n");

console.log("— Un saludo suelto no debe heredar una patente vieja de otro trámite —");
await assertResolution(
  "'hola, buenas' en hilo con OST 223 mencionada antes no resuelve OST 223",
  { rawText: "hola, buenas", threadText: threadWithOldPlate, units: fleet },
  { noPlate: true },
);
await assertResolution(
  "'gracias!' en hilo con OST 223 mencionada antes no resuelve OST 223",
  { rawText: "gracias!", threadText: threadWithOldPlate, units: fleet },
  { noPlate: true },
);

console.log("\n— Una unidad NUEVA y explícita no se contamina con la vieja del hilo —");
await assertResolution(
  "Pide otra unidad por marca explícita (AD) ignora OST 223 del hilo",
  { rawText: "ahora quiero saber de la AD 427 MC", threadText: threadWithOldPlate, units: fleet },
  { plate: "AD427MC", intent: "consult_status" },
);

console.log("\n— Referencia vaga SÍ debe reusar la patente ya confirmada (el fix real de hoy) —");
await assertResolution(
  "'la unidad mencionada' reusa AG 562 SP ya confirmada en el hilo",
  {
    rawText: "dame el certificado de la unidad mencionada",
    threadText: "Perfecto, tomo AG 562 SP. Generé el caso.",
    units: fleet,
    certificateContext: true,
  },
  { plate: "AG562SP", intent: "consult_status" },
);
await assertResolution(
  "'esa unidad' sigue reusando la patente ya confirmada (comportamiento previo intacto)",
  {
    rawText: "dame el certificado de esa unidad",
    threadText: "Perfecto, tomo AG 562 SP. Generé el caso.",
    units: fleet,
    certificateContext: true,
  },
  { plate: "AG562SP", intent: "consult_status" },
);

console.log("\n— Referencia vaga sin ninguna patente previa no rompe ni inventa una —");
await assertResolution(
  "'la unidad mencionada' sin ninguna patente antes en el hilo pide aclaración",
  { rawText: "dame el certificado de la unidad mencionada", threadText: "", units: fleet, certificateContext: true },
  { noPlate: true, intent: "need_clarification" },
);

console.log("\n— Corrección explícita de patente toma la CORREGIDA, no la rechazada —");
await assertResolution(
  "'no es la OST 223, es la AD 427 MC' resuelve AD 427 MC (la corregida)",
  { rawText: "no es la OST 223, es la AD 427 MC", threadText: "", units: fleet },
  { plate: "AD427MC", intent: "consult_status" },
);
await assertResolution(
  "'perdon, no es la OST 223 sino la AG 562 SP' resuelve AG 562 SP (la corregida)",
  { rawText: "perdon, no es la OST 223 sino la AG 562 SP", threadText: "", units: fleet },
  { plate: "AG562SP", intent: "consult_status" },
);

console.log("\n— Búsqueda por marca con relleno conversacional sigue funcionando (fix de hoy más temprano) —");
await assertResolution(
  "'que pasa con la saveiro' sigue resolviendo por nombre de unidad, sin contaminarse",
  {
    rawText: "que pasa con la saveiro",
    threadText: "",
    units: [...fleet, { movil_id: 4, patente: "LWK 790", unidad: "VW SAVEIRO" }],
  },
  { plate: "LWK790", intent: "consult_status" },
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s) en verify-context-continuity-safety.mjs`);
  process.exit(1);
}
console.log("\n✓ Verificación de seguridad de continuidad de contexto OK (sin contaminación cruzada entre trámites)");
