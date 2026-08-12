/**
 * Pruebas conversacionales de paridad V2 — flujos completos con mock WARA.
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
  getPilotConversationState,
} from "./operational-turn.js";
import {
  configurePilotStatePersistence,
  resetPilotConversationStatesForTests as resetStateStore,
} from "./conversation-state.js";
import type { WaraEmpresaContact, WaraUnidadEstado } from "./wara-types.js";
import { assessUnitReporting, buildGpsReportForUnit } from "./gps-core.js";
import { filterValidFleetUnits, resolveUnitFromListing, buildPaginatedListing } from "./unit-fleet.js";

const PHONE = "+5491133788190";
const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

const CONTACTS: WaraEmpresaContact[] = [
  { id: 1, nombre: "Cliente", empresa: "WARA Lab" },
];

function buildMockFleet(): WaraUnidadEstado[] {
  const units: WaraUnidadEstado[] = [];
  for (let i = 1; i <= 30; i++) {
    const plate = `AA${String(100 + i).padStart(3, "0")}${i % 2 === 0 ? "BC" : "CD"}`;
    units.push({
      movil_id: 1000 + i,
      unidad: `M600-${String(i).padStart(3, "0")}`,
      patente: plate,
      ultimo_reporte: { hace_segundos: 120 + i },
      ultima_posicion: { hace_segundos: 130 + i, lat: -34.6, lon: -58.4 },
      ultima_ignicion: { estado: i % 3 !== 0, hace_segundos: 140 + i },
    });
  }
  units.push({
    movil_id: 9999,
    unidad: "MYQ",
    patente: "AC427MY",
    ultimo_reporte: { hace_segundos: 90 },
    ultima_posicion: { hace_segundos: 95, lat: -34.61, lon: -58.41 },
    ultima_ignicion: { estado: "SI", hace_segundos: 100 },
  });
  units.push({
    movil_id: 8888,
    unidad: "ALTAMIRANDA JOSE",
    patente: "AD111AA",
    ultimo_reporte: { hace_segundos: 200 },
    ultima_posicion: { hace_segundos: 210 },
    ultima_ignicion: { estado: false, hace_segundos: 220 },
  });
  return units;
}

const MOCK_FLEET = buildMockFleet();

function mockDeps(overrides?: {
  fleet?: WaraUnidadEstado[];
  fail?: boolean;
}) {
  const fleet = overrides?.fleet ?? MOCK_FLEET;
  setPilotOperationalDepsForTests({
    createToken: async () => ({ ok: true, sessionToken: "mock-token" }),
    consultarFleet: async () => {
      if (overrides?.fail) {
        return { ok: false, unidades: [], error: "WARA no disponible (mock)" };
      }
      return { ok: true, unidades: fleet };
    },
  });
}

async function turn(
  text: string,
  opts?: { phone?: string; tenant?: string },
): Promise<string> {
  const r = await resolveOperationalTurn({
    tenantId: opts?.tenant ?? TENANT_A,
    phone: opts?.phone ?? PHONE,
    text,
    env: {
      WARA_OBTENER_EMPRESA_TOKEN: "mock",
      WARA_API_BASE_URL: "http://mock",
    },
    contacts: CONTACTS,
    customerName: "Test",
  });
  if (r.kind === "llm") return `[LLM:${r.snapshot.units_preview.length}]`;
  return r.message;
}

describe("paridad conversacional V2 — bloque operativo", () => {
  let tempDir: string;

  beforeEach(() => {
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-pilot-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    mockDeps();
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    resetStateStore();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("listar unidades → seleccionar 22 → unidad correcta", async () => {
    const list = await turn("listas de unidades");
    assert.match(list, /Unidades en WARA Lab/);
    assert.match(list, /1\./);

    const pick = await turn("22");
    assert.match(pick, /M600-022|AA 122 BC/);
    assert.match(pick, /reporte GPS/i);

    const yes = await turn("sí");
    assert.match(yes, /Funcionamiento normal|M600-022|AA122/);
    assert.doesNotMatch(yes, /\[LLM/);
  });

  it("paginación siguiente/anterior y selección", async () => {
    await turn("listas de unidades");
    const page2 = await turn("siguiente");
    assert.match(page2, /página 2\//);

    const page1 = await turn("anterior");
    assert.match(page1, /página 1\//);

    await turn("siguiente");
    await turn("siguiente");
    const pick = await turn("la 22");
    assert.match(pick, /reporte GPS/i);
  });

  it("solo patentes — todas provienen del mock WARA", async () => {
    const msg = await turn("solo patentes");
    assert.match(msg, /patentes reales.*WARA/i);
    assert.match(msg, /AA 101/);
    assert.match(msg, /según WARA/);
    assert.doesNotMatch(msg, /invent/i);
  });

  it("buscar patente existente AC427MY", async () => {
    const msg = await turn("reporte AC427MY");
    assert.match(msg, /MYQ|AC 427 MY|reporte GPS/i);
  });

  it("buscar patente inexistente", async () => {
    const msg = await turn("reporte ZZ999ZZ");
    assert.match(msg, /No encontré/i);
    assert.doesNotMatch(msg, /Funcionamiento normal/);
  });

  it("buscar por nombre MYQ — un resultado", async () => {
    const msg = await turn("reporte de MYQ");
    assert.match(msg, /MYQ|AC 427 MY|reporte GPS/i);
    assert.doesNotMatch(msg, /\[LLM/);
  });

  it("buscar por nombre ambiguo ALTAMIRANDA", async () => {
    const fleet = buildMockFleet();
    fleet.push({
      movil_id: 7777,
      unidad: "ALTAMIRANDA PEDRO",
      patente: "AD222BB",
      ultimo_reporte: { hace_segundos: 100 },
      ultima_posicion: { hace_segundos: 110 },
    });
    mockDeps({ fleet });
    const msg = await turn("ALTAMIRANDA");
    assert.match(msg, /Encontré 2 unidades|ALTAMIRANDA/);
  });

  it("GPS MYQ usa assessment determinístico", () => {
    const myq = MOCK_FLEET.find((u) => u.unidad === "MYQ")!;
    const assessment = assessUnitReporting(myq);
    assert.ok(assessment);
    const report = buildGpsReportForUnit(myq);
    assert.match(report, /MYQ|AC 427 MY/);
    assert.match(report, /reporte|Funcionamiento normal|detenida/i);
  });

  it("seleccionar unidad → reporte → sí", async () => {
    await turn("listas de unidades");
    await turn("3");
    const yes = await turn("si");
    assert.match(yes, /Funcionamiento normal|detenida|reporte/i);
  });

  it("cambiar de unidad durante trámite", async () => {
    await turn("reporte de MYQ");
    const change = await turn("otra unidad");
    assert.match(change, /cambiamos de unidad/i);
  });

  it("interrumpir con lista → reanudar", async () => {
    await turn("reporte de MYQ");
    await turn("listas de unidades");
    const resume = await turn("continuamos");
    assert.match(resume, /reporte GPS|MYQ|Retomamos/i);
  });

  it("persistencia de sesión tras reload simulado", async () => {
    await turn("listas de unidades");
    resetStateStore();
    configurePilotStatePersistence(join(tempDir, "state.json"));
    const pick = await turn("22");
    assert.match(pick, /reporte GPS/i);
  });

  it("aislamiento entre tenants", async () => {
    await turn("listas de unidades", { tenant: TENANT_A });
    const b = await turn("22", { tenant: TENANT_B, phone: "+5491199990001" });
    assert.match(b, /No encontré «22»|No hay opción 22|Unidades en/i);
  });

  it("mensaje duplicado", async () => {
    await turn("listas de unidades");
    const dup = await turn("listas de unidades");
    assert.match(dup, /Ya recibí ese mensaje/i);
  });

  it("error WARA sin alucinación", async () => {
    mockDeps({ fail: true });
    const msg = await turn("listas de unidades");
    assert.match(msg, /WARA no disponible|No pude consultar/i);
    assert.doesNotMatch(msg, /Funcionamiento normal/);
  });

  it("índice inexistente rechazado", async () => {
    await turn("listas de unidades");
    const bad = await turn("999");
    assert.match(bad, /No hay opción 999/);
  });

  it("cancelar trámite", async () => {
    await turn("reporte de MYQ");
    const cancel = await turn("cancelar");
    assert.match(cancel, /cancelé el trámite/i);
  });

  it("mapa índice → unidad en listado de 30+", () => {
    const valid = filterValidFleetUnits(MOCK_FLEET);
    const listing = buildPaginatedListing({ units: valid, page: 3 });
    const ref = resolveUnitFromListing(listing, 22);
    assert.ok(ref);
    assert.equal(ref.movil_id, 1022);
  });
});

describe("unit-fleet puro", () => {
  it("filtra duplicados y ordena estable", () => {
    const raw = [
      { movil_id: 2, unidad: "B", patente: "AA200BB" },
      { movil_id: 1, unidad: "A", patente: "AA100AA" },
      { movil_id: 2, unidad: "B dup", patente: "AA200BB" },
      { movil_id: 3, unidad: "", patente: "" },
    ];
    const out = filterValidFleetUnits(raw);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.movil_id, 1);
  });
});
