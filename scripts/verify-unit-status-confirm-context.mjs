#!/usr/bin/env node
/**
 * Regresión — Bug real, producción 2026-07-29:
 *   Cliente corrige patente → bot ofrece revisar estado → "Si" reseteaba empresa.
 *   "La ADv578Wx" se parseaba como LAADV578WX.
 *
 * Uso: npx tsx scripts/verify-unit-status-confirm-context.mjs
 */
import assert from "node:assert";
import {
  detectLoosePlate,
  stripLeadingPlateArticle,
  threadHasPendingUnitStatusCheckOffer,
  extractPlateFromUnitStatusCheckOffer,
  looksLikeBriefConfirmation,
} from "../src/lib/wara.ts";
import { looksLikeImplicitCompanyChangeAffirmation } from "../src/lib/waraApi.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

console.log("— Patente con artículo inicial —");
check(
  'detectLoosePlate("La AD 578 WX") === AD578WX',
  detectLoosePlate("La AD 578 WX") === "AD578WX",
);
check(
  'stripLeadingPlateArticle("La AD578WX")',
  stripLeadingPlateArticle("La AD578WX") === "AD578WX",
);
check(
  'Ya no incluye "La" en patente compacta (LAADV578WX)',
  detectLoosePlate("La AD 578 WX") !== "LAADV578WX",
);

console.log("\n— Oferta de revisar estado en hilo —");
const statusOfferThread = [
  "La patente LAADV578WX no está en la flota de El Cacique S.A.",
  "Si es de otra empresa, escribí «cambiar empresa».",
  "Parece que hubo un error en la escritura de la patente. La que mencionaste es 'AD 578 WX'. ¿Querés que revise el estado de esa unidad?",
].join("\n");
check(
  "threadHasPendingUnitStatusCheckOffer detecta la pregunta",
  threadHasPendingUnitStatusCheckOffer(statusOfferThread) === true,
);
check(
  "extractPlateFromUnitStatusCheckOffer → AD578WX",
  extractPlateFromUnitStatusCheckOffer(statusOfferThread) === "AD578WX",
);

console.log("\n— 'Si' NO es cambio de empresa implícito —");
check(
  'looksLikeImplicitCompanyChangeAffirmation("Si", statusOfferThread) === false',
  looksLikeImplicitCompanyChangeAffirmation("Si", statusOfferThread) === false,
);
check(
  "looksLikeBriefConfirmation('Si')",
  looksLikeBriefConfirmation("Si") === true,
);

console.log("\n— Cambio de empresa explícito sigue funcionando —");
const changeCompanyThread = "¿Querés que reiniciemos la empresa para elegir otra?";
check(
  'looksLikeImplicitCompanyChangeAffirmation("si", changeCompanyThread)',
  looksLikeImplicitCompanyChangeAffirmation("si", changeCompanyThread) === true,
);

console.log(`\n✅ ${passed} checks pasaron.`);
