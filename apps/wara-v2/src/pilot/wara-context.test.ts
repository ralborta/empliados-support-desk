import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  looksLikeChangeCompanyRequest,
  looksLikeCompanySelection,
  looksLikeUnitsListRequest,
  matchCompanySelection,
} from "./wara-intents.js";
import { formatUnitsList } from "./wara-format.js";
import { resetPilotWaraSessionsForTests } from "./wara-context.js";

const CONTACTS = [
  { id: 64866, empresa: "WARA", nombre: "Emma" },
  { id: 131776, empresa: "El Cacique S.A.", nombre: "Emma" },
];

describe("wara intents piloto", () => {
  beforeEach(() => {
    resetPilotWaraSessionsForTests();
  });

  it("detecta cambio de empresa", () => {
    assert.equal(looksLikeChangeCompanyRequest("Cambio de empresa"), true);
    assert.equal(looksLikeChangeCompanyRequest("lista de unidades"), false);
  });

  it("matchea selección numérica y por nombre", () => {
    assert.equal(matchCompanySelection("2", CONTACTS)?.empresa, "El Cacique S.A.");
    assert.equal(matchCompanySelection("el cacique", CONTACTS)?.id, 131776);
  });

  it("detecta pedido de lista de unidades", () => {
    assert.equal(looksLikeUnitsListRequest("Listas de unidades"), true);
    assert.equal(looksLikeUnitsListRequest("Reporte"), false);
  });

  it("formatea unidades desde WARA", () => {
    const msg = formatUnitsList([
      { movil_id: 1, unidad: "M300-111", patente: "AD427MC" },
    ]);
    assert.match(msg, /AD 427 MC/);
    assert.match(msg, /M300-111/);
  });

  it("selección de empresa no confunde con saludo", () => {
    assert.equal(looksLikeCompanySelection("Hola"), false);
    assert.equal(looksLikeCompanySelection("2"), true);
  });
});
