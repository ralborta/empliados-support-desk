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
} from "./operational-turn.js";
import {
  configurePilotStatePersistence,
  resetPilotConversationStatesForTests as resetStateStore,
  getPilotConversationState,
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

let msgSeq = 0;

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
  opts?: { phone?: string; tenant?: string; messageId?: string },
): Promise<string> {
  msgSeq += 1;
  const r = await resolveOperationalTurn({
    tenantId: opts?.tenant ?? TENANT_A,
    phone: opts?.phone ?? PHONE,
    text,
    messageId: opts?.messageId ?? `test-msg-${msgSeq}`,
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
    msgSeq = 0;
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
    // Sin GPS por defecto: tras seleccionar, pregunta qué gestionar.
    assert.match(pick, /Seleccioné|consultar o gestionar/i);
    assert.doesNotMatch(pick, /reporte GPS/i);

    const askGps = await turn("pasame el estado");
    // Lectura: entrega directa (sin ¿Querés el reporte?).
    assert.match(askGps, /Funcionamiento normal|M600-022|AA122|reporte|posición|posicion|señal|senal/i);
    assert.doesNotMatch(askGps, /Querés el reporte GPS/i);
    assert.doesNotMatch(askGps, /Recibí el dato/i);
  });

  it("siguiente con messageIds distintos avanza; repetir id no", async () => {
    await turn("listas de unidades", { messageId: "list-1" });
    const p2 = await turn("siguiente", { messageId: "sig-a" });
    assert.match(p2, /página 2\//);
    const p3 = await turn("siguiente", { messageId: "sig-b" });
    assert.match(p3, /página 3\//);
    const dup = await turn("siguiente", { messageId: "sig-b" });
    assert.match(dup, /messageId duplicado/i);
  });

  it("reporte MYQ entrega lectura sin confirmación redundante", async () => {
    const report = await turn("reporte de MYQ", { messageId: "myq-1" });
    assert.match(report, /MYQ|AC 427 MY|Funcionamiento normal/i);
    assert.doesNotMatch(report, /Querés el reporte GPS/i);

    const report2 = await turn("reporte AC427MY", { messageId: "myq-2" });
    assert.match(report2, /MYQ|AC 427 MY|Funcionamiento normal/i);
    assert.doesNotMatch(report2, /Querés el reporte GPS|Recibí el dato/i);
  });

  it("reporte MYQ prioriza sobre unidad activa previa", async () => {
    await turn("listas de unidades");
    await turn("22");
    const myq = await turn("reporte de MYQ");
    assert.match(myq, /MYQ|AC 427 MY/);
    assert.doesNotMatch(myq, /AA 122 BC/);
  });

  it("patente inexistente no reutiliza unidad anterior", async () => {
    await turn("listas de unidades");
    await turn("22");
    const bad = await turn("reporte ZZ999ZZ");
    assert.match(bad, /No encontré/i);
    assert.doesNotMatch(bad, /AA 122 BC/);
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
    assert.match(pick, /Seleccioné|consultar o gestionar|M600-022|AA 122/i);
    assert.doesNotMatch(pick, /reporte GPS/i);
  });

  it("solo patentes — todas provienen del mock WARA", async () => {
    const msg = await turn("solo patentes");
    assert.match(msg, /patentes reales.*WARA/i);
    assert.match(msg, /AA 101/);
  });

  it("buscar patente existente AC427MY", async () => {
    const msg = await turn("reporte AC427MY");
    assert.match(msg, /MYQ|AC 427 MY|reporte GPS/i);
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
    assert.ok(assessUnitReporting(myq));
    assert.match(buildGpsReportForUnit(myq), /MYQ|AC 427 MY/);
  });

  it("interrupción con lista → reanudar", async () => {
    await turn("reporte de MYQ");
    await turn("listas de unidades");
    const resume = await turn("continuamos");
    assert.match(resume, /reporte GPS|MYQ|Retomamos/i);
  });

  it("persistencia de sesión y messageIds tras reload", async () => {
    await turn("listas de unidades", { messageId: "persist-list" });
    resetStateStore();
    configurePilotStatePersistence(join(tempDir, "state.json"));
    const st = getPilotConversationState(TENANT_A, PHONE);
    assert.ok(st?.lastListing);
    assert.ok(st?.processedMessageIds?.["persist-list"]);
    const pick = await turn("22", { messageId: "persist-22" });
    assert.match(pick, /Seleccioné|consultar o gestionar|M600-022|AA 122/i);
    assert.doesNotMatch(pick, /reporte GPS/i);
  });

  it("deduplicación messageId sobrevive reinicio", async () => {
    await turn("listas de unidades", { messageId: "dedupe-1" });
    resetStateStore();
    configurePilotStatePersistence(join(tempDir, "state.json"));
    const dup = await turn("listas de unidades", { messageId: "dedupe-1" });
    assert.match(dup, /messageId duplicado/i);
  });

  it("aislamiento entre tenants", async () => {
    await turn("listas de unidades", { tenant: TENANT_A });
    const b = await turn("22", { tenant: TENANT_B, phone: "+5491199990001" });
    assert.match(b, /No encontré «22»|No hay opción 22|Unidades en/i);
  });

  it("error WARA sin alucinación", async () => {
    mockDeps({ fail: true });
    const msg = await turn("listas de unidades");
    assert.match(msg, /WARA no disponible|No pude consultar/i);
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
