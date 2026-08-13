/**
 * GPS «estado/reporte» + resolución por patente / código / nombre.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractUnitNameCode,
  resolveUnitByNameFromFleet,
  unitAwaitAskMessage,
} from "../unit-fleet.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const FLEET: WaraUnidadEstado[] = [
  {
    movil_id: 71,
    unidad: "M900-071",
    patente: "AA175BY",
    odometro: 1,
    horometro: 1,
    ultimo_reporte: { hace_segundos: 10 },
  },
  {
    movil_id: 72,
    unidad: "M900-072",
    patente: "AD307VN",
    odometro: 1,
    horometro: 1,
    ultimo_reporte: { hace_segundos: 20 },
  },
];

describe("unit identity + gps ask copy", () => {
  it("resuelve por código M900-072 y 900-072", () => {
    assert.ok(extractUnitNameCode("M900-072"));
    assert.ok(extractUnitNameCode("900-072"));
    const a = resolveUnitByNameFromFleet(FLEET, "M900-072");
    const b = resolveUnitByNameFromFleet(FLEET, "900-072");
    assert.equal(a.kind, "one");
    assert.equal(b.kind, "one");
    if (a.kind === "one" && b.kind === "one") {
      assert.equal(a.unit.movil_id, 72);
      assert.equal(b.unit.movil_id, 72);
    }
  });

  it("ask GPS menciona patente, número y nombre", () => {
    assert.match(unitAwaitAskMessage("gps"), /patente/i);
    assert.match(unitAwaitAskMessage("gps"), /n[uú]mero|nombre/i);
    assert.doesNotMatch(unitAwaitAskMessage("gps"), /^Decime la patente\.$/i);
  });
});
