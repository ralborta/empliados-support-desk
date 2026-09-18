/**
 * Pruebas conversacionales humanas — regresión vs captura real El Cacique + frases naturales.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
} from "./operational-turn.js";
import {
  configurePilotStatePersistence,
  resetPilotConversationStatesForTests as resetState,
} from "./conversation-state.js";
import type { WaraEmpresaContact, WaraUnidadEstado } from "./wara-types.js";
import { interpretUnitSearchRules } from "./unit-search-semantics.js";

const PHONE = "+5491133788190";
const TENANT = "tenant_cacique";

const CONTACTS: WaraEmpresaContact[] = [
  { id: 1, nombre: "Raúl", empresa: "El Cacique S.A." },
];

function buildCaciqueFleet(): WaraUnidadEstado[] {
  return [
    { movil_id: 1, patente: "AD356UQ", unidad: "M900-001", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 2, patente: "AD999ZZ", unidad: "M900-002", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 3, patente: "AA815XE", unidad: "M900-108", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 4, patente: "AA815XF", unidad: "M900-105", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 5, patente: "AA815XO", unidad: "M900-106", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 6, patente: "AA815XP", unidad: "M900-107", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 7, patente: "AA820BB", unidad: "M900-120", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 8, patente: "AA821CC", unidad: "M900-121", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
    { movil_id: 9, patente: "AB815XU", unidad: "M900-200", ultimo_reporte: { hace_segundos: 120 }, ultima_posicion: { hace_segundos: 130 }, ultima_ignicion: { estado: true, hace_segundos: 140 } },
  ];
}

let msgSeq = 0;

async function turn(text: string): Promise<string> {
  msgSeq += 1;
  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `human-${msgSeq}`,
    env: { WARA_OBTENER_EMPRESA_TOKEN: "mock", WARA_API_BASE_URL: "http://mock" },
    contacts: CONTACTS,
    customerName: "Raúl",
  });
  if (r.kind === "llm") return `[LLM:${r.snapshot.units_preview.length}]`;
  return r.message;
}

describe("interpretación semántica — reglas", () => {
  it("el estado de la q empieza con ad → unit_status prefix AD", () => {
    const i = interpretUnitSearchRules("el estado de la q empieza con ad");
    assert.ok(i);
    assert.equal(i!.intent, "unit_status");
    assert.equal(i!.matchMode, "prefix");
    assert.equal(i!.query, "AD");
  });

  it("la patente q empieza con AD → find_unit prefix AD", () => {
    const i = interpretUnitSearchRules("la patente q empieza con AD");
    assert.ok(i);
    assert.equal(i!.intent, "find_unit");
    assert.equal(i!.query, "AD");
  });

  it("con AA82 → prefix AA82", () => {
    const i = interpretUnitSearchRules("con AA82");
    assert.ok(i);
    assert.equal(i!.matchMode, "prefix");
    assert.equal(i!.query, "AA82");
  });

  it("AA815 → prefix parcial", () => {
    const i = interpretUnitSearchRules("AA815");
    assert.ok(i);
    assert.equal(i!.matchMode, "prefix");
    assert.equal(i!.query, "AA815");
  });

  it("mostrame las que tengan 815 → contains", () => {
    const i = interpretUnitSearchRules("mostrame las que tengan 815");
    assert.ok(i);
    assert.equal(i!.matchMode, "contains");
    assert.equal(i!.query, "815");
  });

  it("patentre q empieza con AD tolera typo", () => {
    const i = interpretUnitSearchRules("la patentre q empieza con AD");
    assert.ok(i);
    assert.equal(i!.query, "AD");
  });
});

describe("conversación humana — captura El Cacique corregida", () => {
  let tempDir: string;

  beforeEach(() => {
    msgSeq = 0;
    resetState();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-human-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "mock-token" }),
      consultarFleet: async () => ({ ok: true, unidades: buildCaciqueFleet() }),
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    resetState();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("captura original — prefijos AD y AA815 sin búsqueda literal", async () => {
    const s1 = await turn("el estado de la q empieza con ad");
    assert.match(s1, /Encontré 2 unidades.*AD/i);
    assert.match(s1, /AD 356 UQ/);
    assert.doesNotMatch(s1, /No encontré «a q empieza/i);

    const s2 = await turn("AD");
    assert.match(s2, /Encontré 2 unidades.*AD/i);

    const s3 = await turn("la patente q empieza con AD");
    assert.match(s3, /Encontré 2 unidades/i);
    assert.doesNotMatch(s3, /patentre/i);

    const s4 = await turn("con AA82");
    assert.match(s4, /Encontré 2 unidades.*AA82|AA 820|AA 821/i);

    const s5 = await turn("AA815");
    assert.match(s5, /Encontré [34] unidades.*AA815/i);
    assert.match(s5, /AA 815 XE/);
    assert.doesNotMatch(s5, /No encontré «AA815»/i);
  });

  it("selección por índice y ordinales", async () => {
    await turn("buscame las patentes AD");
    const pickNum = await turn("1");
    assert.match(pickNum, /reporte GPS|AD 356 UQ/i);

    await turn("buscame las patentes AD");
    const pickOrd = await turn("la segunda");
    assert.match(pickOrd, /reporte GPS|AD 999/i);
  });

  it("contains 815 y suffix XU", async () => {
    const contains = await turn("mostrame las que tengan 815");
    assert.match(contains, /Encontré [45] unidades/i);
    assert.match(contains, /815/);

    const suffix = await turn("quiero saber de la q termina en XU");
    assert.match(suffix, /815 XU|AB 815 XU|reporte GPS/i);
  });

  it("frases naturales alternativas", async () => {
    const a = await turn("la q empieza con ad");
    assert.match(a, /Encontré 2 unidades/i);

    const b = await turn("alguna patente que arranque en ad");
    assert.match(b, /Encontré 2 unidades/i);

    const c = await turn("buscame las patentes AD");
    assert.match(c, /Encontré 2 unidades/i);
  });

  it("confirmación sí no se interpreta como prefijo SI", async () => {
    await turn("reporte AD356UQ");
    const yes = await turn("sí");
    assert.match(yes, /AD 356 UQ|Funcionamiento normal/i);
    assert.doesNotMatch(yes, /empiecen con «SI»/i);
  });

  it("patente inexistente no reutiliza unidad anterior", async () => {
    await turn("el estado de la q empieza con ad");
    await turn("1");
    const bad = await turn("ZZZZZZ");
    assert.match(bad, /No encontré/i);
    assert.doesNotMatch(bad, /AD 356 UQ.*Funcionamiento normal/s);
  });
});
