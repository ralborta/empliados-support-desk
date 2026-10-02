#!/usr/bin/env node
/**
 * Regresión #2809269: fila pegada del listado (*ZBF 1418* · 🔢 *35*) no debe
 * confundirse con ZBF14180 ni re-listar la flota.
 * Uso: npx tsx scripts/verify-fleet-list-row-pick.mjs
 */
import assert from "node:assert/strict";
import { resolveUnitQuery } from "../src/lib/waraUnitIntent.ts";

const fleet = [
  { movil_id: 10, patente: "ZBF14180", unidad: "1", marca: "" },
  { movil_id: 20, patente: "ZBF 1418", unidad: "35", marca: "" },
  { movil_id: 30, patente: "ABC123", unidad: "99", marca: "Ford" },
];

const thread = [
  "Cliente: listado de mis unidades",
  "Kira: 📋 *Listado de unidades*",
  "🏢 *Ciudad de Paraná*",
  "🚗 *11* unidades — te muestro *1–11*, ordenadas por nro.",
  "",
  "1. 🚗 *ZBF14180* · 🔢 *1* · 🏭 s/ marca",
  "2. 🚗 *ZBF 1418* · 🔢 *35* · 🏭 s/ marca",
  "",
  "➡️ Si querés el estado de una, pasame la patente o el nro.",
].join("\n");

const pasted = "*ZBF 1418* - 🔢 *35* - 🚨 s/ marca";
const pastedDot = "2. 🚗 *ZBF 1418* · 🔢 *35* · 🏭 s/ marca";

const r1 = await resolveUnitQuery({
  rawText: pasted,
  threadText: thread,
  units: fleet,
  preferAi: false,
});
assert.equal(r1.intent, "consult_status", `paste → consult (obtuvo ${r1.intent})`);
assert.equal(r1.plate, "ZBF1418", `paste plate ZBF1418 (obtuvo ${r1.plate})`);
assert.equal(r1.candidatePlates.length, 1);

const r2 = await resolveUnitQuery({
  rawText: pastedDot,
  threadText: thread,
  units: fleet,
  preferAi: false,
});
assert.equal(r2.intent, "consult_status");
assert.equal(r2.plate, "ZBF1418");

const r3 = await resolveUnitQuery({
  rawText: "35",
  threadText: thread,
  units: fleet,
  preferAi: false,
});
assert.equal(r3.intent, "consult_status", `nro interno 35 → consult (obtuvo ${r3.intent})`);
assert.equal(r3.plate, "ZBF1418");

// Prefijo real sin exacta: ZBF1418 no en flota, solo ZBF14180 → sigue el includes.
const onlyLong = [{ movil_id: 1, patente: "ZBF14180", unidad: "1", marca: "" }];
const r4 = await resolveUnitQuery({
  rawText: "ZBF1418",
  threadText: thread,
  units: onlyLong,
  preferAi: false,
});
assert.equal(r4.intent, "consult_status");
assert.equal(r4.plate, "ZBF14180");

console.log("OK verify-fleet-list-row-pick");
