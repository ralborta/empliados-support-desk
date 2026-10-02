#!/usr/bin/env node
/**
 * Búsqueda por marca/modelo: campos marca/modelo de Wara + Nissan/Saveiro en lenguaje natural.
 */
import assert from "node:assert/strict";
import { looksLikeVehicleBrandOrUnitSearch } from "../src/lib/waraApi.ts";
import {
  extractBrandSearchLabel,
  formatUnitListLabel,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";

const fleet = [
  { movil_id: 1, patente: "AG 562 SP", unidad: "M900-101", marca: "Nissan", modelo: "Frontier" },
  { movil_id: 2, patente: "AH 701 XK", unidad: "M900-102", marca: "Volkswagen", modelo: "Saveiro" },
  { movil_id: 3, patente: "OST 223", unidad: "M300-111" },
];

console.log("— Detecta marca en pregunta natural —");
assert.equal(extractBrandSearchLabel("Quiero el estado de la Saveiro"), "Saveiro");
assert.equal(extractBrandSearchLabel("marca Nissan")?.toLowerCase(), "nissan");
assert.equal(looksLikeVehicleBrandOrUnitSearch("modelo Saveiro"), true);

console.log("— Busca por campo marca/modelo (no solo nombre de unidad) —");
const saveiro = await resolveUnitQuery({
  rawText: "la Saveiro",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert.equal(saveiro.intent, "consult_status");
assert.equal(saveiro.plate?.replace(/\s+/g, ""), "AH701XK");

const nissan = await resolveUnitQuery({
  rawText: "Quiero ver la Nissan",
  threadText: "",
  units: fleet,
  preferAi: false,
});
assert.equal(nissan.intent, "consult_status");
assert.equal(nissan.plate?.replace(/\s+/g, ""), "AG562SP");

console.log("— Etiqueta de lista incluye marca/modelo —");
const label = formatUnitListLabel(fleet[1]);
assert.match(label, /Saveiro/);
assert.match(label, /AH\s*701/);

console.log("OK verify-brand-marca-modelo-search");
