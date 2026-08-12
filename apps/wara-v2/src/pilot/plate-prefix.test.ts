import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractPartialPlateToken,
  extractPlatePrefixFromMessage,
  extractUnitSearchHint,
  filterUnitsByPlatePrefix,
  isBarePlatePrefixHint,
} from "./plate-prefix.js";
import type { WaraUnidadEstado } from "./wara-types.js";

const UNITS: WaraUnidadEstado[] = [
  { movil_id: 1, patente: "AD356UQ", unidad: "M900-001" },
  { movil_id: 2, patente: "AD999ZZ", unidad: "M900-002" },
  { movil_id: 3, patente: "AA815XE", unidad: "M900-108" },
  { movil_id: 4, patente: "AA815XZ", unidad: "M900-105" },
];

describe("plate-prefix V2", () => {
  it("empieza con AD — frase natural", () => {
    assert.equal(extractPlatePrefixFromMessage("el estado de a q empieza con ad"), "AD");
    assert.equal(extractPlatePrefixFromMessage("la patente q empieza con AD"), "AD");
  });

  it("AD suelto es prefijo", () => {
    assert.equal(isBarePlatePrefixHint("AD"), true);
    assert.equal(extractUnitSearchHint("AD")?.value, "AD");
  });

  it("con AA82", () => {
    assert.equal(extractPlatePrefixFromMessage("con AA82"), "AA82");
  });

  it("AA815 parcial", () => {
    assert.equal(extractPartialPlateToken("AA815"), "AA815");
  });

  it("filtra unidades por prefijo AD", () => {
    const matches = filterUnitsByPlatePrefix(UNITS, "AD");
    assert.equal(matches.length, 2);
  });

  it("filtra unidades por prefijo AA815", () => {
    const matches = filterUnitsByPlatePrefix(UNITS, "AA815");
    assert.equal(matches.length, 2);
  });
});
