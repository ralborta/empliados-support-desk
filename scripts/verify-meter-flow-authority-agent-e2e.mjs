#!/usr/bin/env node
/**
 * E2E autoridad de flujo odómetro/horómetro con WARA_AGENT_MODE=true.
 * Sin sembrar pendingAction: arranca vacío y usa runTurnExecutorPhase (mismo orden prod).
 * Cero escrituras externas (Wara registrar mockeado / no llamado hasta CONFIRMO).
 *
 * Matriz: horómetro completo, odómetro, cambio de medidor, números ambiguos,
 * GPS lateral, certificado, mantenimiento, empresa, gracias.
 *
 * Uso: npx tsx scripts/verify-meter-flow-authority-agent-e2e.mjs
 */
import assert from "node:assert/strict";

process.env.BUILDERBOT_CONTEXT_API_KEY =
  process.env.BUILDERBOT_CONTEXT_API_KEY || "test-meter-agent-authority-key";
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "true";
process.env.WARA_TURN_BACKEND_SEND = "false";
process.env.WARA_INBOUND_AUDIT_ONLY = "true";
process.env.WARA_DIALOGUE_AI_ODOMETRO = "false";
process.env.WARA_TURN_AI_CLASSIFY = "false";
process.env.WARA_OBTENER_EMPRESA_TOKEN =
  process.env.WARA_OBTENER_EMPRESA_TOKEN || "test-empresa-token";
process.env.WARA_API_BASE_URL = "https://wara.test.local";
process.env.WARA_MAINTENANCE_API_BASE_URL = "https://wara-maint.test.local";
process.env.NODE_ENV = "test";

const { loadVerifyEnv, requireDatabaseUrl } = await import("./load-verify-env.mjs");
requireDatabaseUrl("verify-meter-flow-authority-agent-e2e");
loadVerifyEnv();

const API_KEY = process.env.BUILDERBOT_CONTEXT_API_KEY;
const PHONE = "5490000001219";

const FLEET = [
  {
    unidad: "M900-121",
    patente: "AG382QB",
    movil_id: 900121,
    ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 12 },
    ultima_ignicion: { estado: true, fecha: new Date().toISOString() },
    ultima_posicion: { lat: -34.6, lon: -58.4, fecha: new Date().toISOString() },
  },
  {
    unidad: "M900-111",
    patente: "AH652KW",
    movil_id: 900111,
    ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 20 },
    ultima_ignicion: { estado: false, fecha: new Date().toISOString() },
    ultima_posicion: { lat: -34.61, lon: -58.41, fecha: new Date().toISOString() },
  },
];

let externalWrites = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (/RegistrarCambio|registrar.*odometro|registrar.*horometro|Grabar|Insertar/i.test(url)) {
    externalWrites += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: "mock-write-blocked" }),
    };
  }
  if (/ObtenerContactosPorNumero/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        encontrado: true,
        contactos: [{ id: 131776, empresa: "El Cacique S.A.", nombre: "Test Agent Auth" }],
        SessionToken: "mock-session-token",
      }),
    };
  }
  if (/ObtenerEmpresaPorNumero|CreateChatBotToken/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        SessionToken: "mock-session-token",
        CustomerID: 1,
        CustomerName: "El Cacique S.A.",
      }),
    };
  }
  if (/ConsultarEstadoUnidades|ListarUnidades|ValidarPatente|flota|odometro|horometro|EstadoUnidad/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: FLEET,
        message: "ok",
        ...FLEET[0],
      }),
    };
  }
  if (typeof originalFetch === "function") {
    return originalFetch(input, init);
  }
  return { ok: false, status: 404, json: async () => ({ error: "not mocked" }) };
};

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { clearPendingAction, getPendingAction } = await import("../src/lib/pendingAction.ts");
const { clearActiveUnit, getActiveUnit } = await import("../src/lib/activeUnit.ts");
const { readTurnLayer } = await import("../src/lib/turnLayerContract.ts");
const { readAuthoritativeMeterType } = await import("../src/lib/odometerPendingAuthority.ts");

const transcript = [];

async function ensureCustomer() {
  const existing = await prisma.customer.findUnique({ where: { phone: PHONE } });
  if (existing) return existing;
  return prisma.customer.create({
    data: {
      phone: PHONE,
      name: "Meter Agent Authority E2E",
      companyName: "El Cacique S.A.",
    },
  });
}

async function resetState() {
  await clearPendingAction(prisma, PHONE);
  await clearActiveUnit(prisma, PHONE).catch(() => undefined);
  await prisma.ticketMessage
    .deleteMany({ where: { ticket: { customer: { phone: PHONE } } } })
    .catch(() => undefined);
  const left = await getPendingAction(prisma, PHONE);
  assert.equal(left, null, "resetState debe dejar pendingAction=null");
  externalWrites = 0;
}

function stateSnapshot(pending, activeUnit) {
  const p = pending?.payload ?? {};
  const layer = readTurnLayer(pending);
  return {
    pendingType: pending?.type ?? null,
    pendingExists: Boolean(pending),
    meterType: readAuthoritativeMeterType(pending),
    patente: p.patente ?? null,
    odometro: p.odometro ?? null,
    horometro: p.horometro ?? null,
    fecha: p.fecha ?? null,
    stage: p.stage ?? null,
    activeExpectation: layer?.activeExpectation ?? null,
    activeUnit: activeUnit?.plate ?? null,
  };
}

function assertSnap(label, snap, expect) {
  if (expect.pendingExists !== undefined) {
    assert.equal(snap.pendingExists, expect.pendingExists, `${label} pendingExists`);
  }
  if (expect.pendingType !== undefined) {
    assert.equal(snap.pendingType, expect.pendingType, `${label} pendingType`);
  }
  if (expect.meterType !== undefined) {
    assert.equal(snap.meterType, expect.meterType, `${label} meterType`);
  }
  if (expect.patente !== undefined) {
    assert.equal(
      String(snap.patente ?? "")
        .replace(/\s+/g, "")
        .toUpperCase(),
      String(expect.patente)
        .replace(/\s+/g, "")
        .toUpperCase(),
      `${label} patente`,
    );
  }
  if (expect.odometro !== undefined) {
    assert.equal(snap.odometro ?? null, expect.odometro, `${label} odometro`);
  }
  if (expect.horometro !== undefined) {
    assert.equal(snap.horometro ?? null, expect.horometro, `${label} horometro`);
  }
  if (expect.fecha !== undefined) {
    assert.equal(snap.fecha ?? null, expect.fecha, `${label} fecha`);
  }
  if (expect.activeExpectation !== undefined) {
    assert.equal(snap.activeExpectation, expect.activeExpectation, `${label} activeExpectation`);
  }
}

function logSnap(tag, before, after) {
  console.log(
    `  SNAP ${tag} BEFORE`,
    JSON.stringify({
      pending: before.pendingExists,
      meterType: before.meterType,
      patente: before.patente,
      odometro: before.odometro,
      horometro: before.horometro,
      fecha: before.fecha,
      exp: before.activeExpectation,
    }),
  );
  console.log(
    `  SNAP ${tag} AFTER `,
    JSON.stringify({
      pending: after.pendingExists,
      meterType: after.meterType,
      patente: after.patente,
      odometro: after.odometro,
      horometro: after.horometro,
      fecha: after.fecha,
      exp: after.activeExpectation,
    }),
  );
}

async function turn(label, text) {
  const beforePending = await getPendingAction(prisma, PHONE);
  const beforeUnit = await getActiveUnit(prisma, PHONE).catch(() => null);
  const before = stateSnapshot(beforePending, beforeUnit);

  const result = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: text,
    apiKey: API_KEY,
  });

  const afterPending = await getPendingAction(prisma, PHONE);
  const afterUnit = await getActiveUnit(prisma, PHONE).catch(() => null);
  const after = stateSnapshot(afterPending, afterUnit);

  const row = {
    label,
    inbound: text,
    executor: result.executor,
    ok: result.ok,
    outbound: String(result.message ?? "").slice(0, 280),
    before,
    after,
    externalWrites,
  };
  transcript.push(row);
  console.log(`\n—— ${label} ——`);
  console.log(`IN:  ${text}`);
  console.log(`OUT: ${row.outbound.replace(/\n/g, " / ")}`);
  console.log(
    `exec=${result.executor} meter=${after.meterType} exp=${after.activeExpectation} plate=${after.patente} writes=${externalWrites}`,
  );
  return { result, before, after };
}

function assertNoWrites(label) {
  assert.equal(externalWrites, 0, `${label}: no debe haber escrituras externas`);
}

await ensureCustomer();

console.log("\n========== HORÓMETRO COMPLETO (sin sembrar pending) ==========");
await resetState();
{
  const t1 = await turn("H1 start", "Quiero cambiar el horómetro");
  assert.equal(t1.result.executor, "odometro", "H1 executor odometro");
  assert.equal(t1.after.pendingType, "odometro", "H1 pending odometro");
  assert.equal(t1.after.meterType, "horometro", "H1 meterType horometro");
  assert.equal(t1.after.activeExpectation, "unit", "H1 activeExpectation unit");
  assert.match(t1.result.message, /patente|unidad|interno/i, "H1 pide unidad");
  assertNoWrites("H1");

  const t2 = await turn("H2 unit", "900121");
  assert.equal(t2.result.executor, "odometro", "H2 executor odometro");
  assert.equal(t2.after.meterType, "horometro", "H2 meterType horometro");
  assert.equal(
    String(t2.after.patente ?? "").replace(/\s+/g, "").toUpperCase(),
    "AG382QB",
    "H2 patente AG382QB",
  );
  assert.ok(
    t2.after.activeExpectation === "km" || t2.after.activeExpectation === "fecha_hora",
    `H2 activeExpectation km|fecha_hora (got ${t2.after.activeExpectation})`,
  );
  assert.equal(t2.after.horometro ?? null, null, "H2 900121 es unidad, no horas");
  assertNoWrites("H2");

  const t3 = await turn("H3 value 121988", "121988");
  assert.equal(t3.result.executor, "odometro", "H3 executor odometro (nunca unidades)");
  assert.notEqual(t3.result.executor, "unidades", "H3 no unidades");
  assert.doesNotMatch(
    t3.result.message,
    /unidad no encontrada|coincida con «121988»/i,
    "H3 no busca 121988 como unidad",
  );
  assert.equal(t3.after.meterType, "horometro", "H3 sigue horometro");
  assert.equal(t3.after.horometro, 121988, "H3 valor 121988 hs");
  assert.ok(
    t3.after.activeExpectation === "fecha_hora" ||
      t3.after.activeExpectation === "confirmo" ||
      /fecha|hora|confirmo/i.test(t3.result.message),
    `H3 pide fecha/hora o resumen (exp=${t3.after.activeExpectation})`,
  );
  assertNoWrites("H3");

  // Si H2 ya anotó valor por error no debería pasar; si H3 dejó en fecha_hora:
  if (t3.after.activeExpectation === "fecha_hora") {
    const t4 = await turn("H4 datetime", "05/08/26 a las 14:30");
    assert.equal(t4.result.executor, "odometro", "H4 executor");
    assert.ok(
      t4.after.activeExpectation === "confirmo" || /confirmo/i.test(t4.result.message),
      "H4 pide CONFIRMO",
    );
    assertNoWrites("H4");
  }

  const t5 = await turn("H5 thanks no confirm", "Gracias");
  assert.doesNotMatch(t5.result.message, /listo,\s*registr/i, "Gracias no escribe");
  assert.equal(externalWrites, 0, "H5 cero escrituras");
  // Cortesía no debe confirmar; si abre clarificación lateral, OK mientras no escriba.
}

console.log("\n========== ODÓMETRO COMPLETO ==========");
await resetState();
{
  const t1 = await turn("O1 start", "Quiero cambiar el odómetro");
  assert.equal(t1.result.executor, "odometro");
  assert.equal(t1.after.meterType, "odometro");
  assert.equal(t1.after.activeExpectation, "unit");
  assertNoWrites("O1");

  const t2 = await turn("O2 unit", "900121");
  assert.equal(t2.after.meterType, "odometro", "O2 no cambia a horómetro");
  assert.equal(t2.after.activeExpectation, "km");
  assertNoWrites("O2");

  const t3 = await turn("O3 km", "121988");
  assert.equal(t3.result.executor, "odometro");
  assert.equal(t3.after.odometro, 121988);
  assert.equal(t3.after.meterType, "odometro");
  assert.doesNotMatch(t3.result.message, /unidad no encontrada|«121988»/i);
  assertNoWrites("O3");
}

console.log("\n========== CORRECCIÓN / CAMBIO DE MEDIDOR ==========");
await resetState();
{
  await turn("S1", "Quiero cambiar el horómetro");
  await turn("S2", "900121");
  const s3 = await turn("S3 switch odo", "No, odómetro");
  logSnap("S3", s3.before, s3.after);
  assertSnap("S3 after", s3.after, {
    pendingExists: true,
    pendingType: "odometro",
    meterType: "odometro",
    patente: "AG382QB",
    horometro: null,
    odometro: null,
    fecha: null,
    activeExpectation: "km",
  });
  assert.equal(
    String(s3.before.patente ?? "")
      .replace(/\s+/g, "")
      .toUpperCase(),
    "AG382QB",
    "S3 conserva misma unidad (antes ya era AG382QB)",
  );
  assert.doesNotMatch(s3.result.message, /¿de qué unidad|pasame la \*patente\*/i);
  assertNoWrites("S3");
}
await resetState();
{
  await turn("S4", "Quiero cambiar el horómetro");
  await turn("S5", "900121");
  const s6 = await turn("S6 quiero odo", "Quiero hacer odómetro");
  logSnap("S6", s6.before, s6.after);
  assertSnap("S6 after", s6.after, {
    pendingExists: true,
    meterType: "odometro",
    patente: "AG382QB",
    horometro: null,
    activeExpectation: "km",
  });
  assertNoWrites("S6");
}
await resetState();
{
  await turn("S7", "Quiero cambiar el odómetro");
  await turn("S8", "900121");
  const s9 = await turn("S9 switch horo", "No, horómetro");
  logSnap("S9", s9.before, s9.after);
  assertSnap("S9 after", s9.after, {
    pendingExists: true,
    meterType: "horometro",
    patente: "AG382QB",
    odometro: null,
    horometro: null,
    fecha: null,
    activeExpectation: "km",
  });
  assert.equal(
    String(s9.before.patente ?? "")
      .replace(/\s+/g, "")
      .toUpperCase(),
    String(s9.after.patente ?? "")
      .replace(/\s+/g, "")
      .toUpperCase(),
    "S9 conserva la misma unidad al cambiar a horómetro",
  );
  assertNoWrites("S9");
}
await resetState();
{
  await turn("S10", "Quiero cambiar el odómetro");
  await turn("S11", "900121");
  const s12 = await turn("S12 bare odo", "odómetro");
  logSnap("S12", s12.before, s12.after);
  assertSnap("S12 after", s12.after, {
    pendingExists: true,
    pendingType: "odometro",
    meterType: "odometro",
    patente: "AG382QB",
    activeExpectation: "km",
  });
  assert.equal(s12.before.pendingExists, true, "S12 no limpia pending (antes existía)");
  assert.equal(s12.after.pendingExists, true, "S12 pending sigue");
  assert.equal(s12.before.patente, s12.after.patente, "S12 misma patente");
  assert.equal(s12.before.meterType, "odometro");
  assert.equal(s12.after.meterType, "odometro");
  assert.equal(s12.before.activeExpectation, "km");
  assert.equal(s12.after.activeExpectation, "km");
  assert.doesNotMatch(s12.result.message, /hor[oó]metro/i, "no menciona horómetro");
  assert.doesNotMatch(
    s12.result.message,
    /¿de qué unidad|pasame la \*patente\*|corregir o actualizar/i,
    "no pide unidad ni action_choice",
  );
  assert.match(s12.result.message, /km|valor|od[oó]metro/i, "repite solo dato pendiente");
  assertNoWrites("S12");
}
await resetState();
{
  await turn("S13", "Quiero cambiar el horómetro");
  await turn("S14", "900121");
  const s15 = await turn("S15 bare horo", "horómetro");
  logSnap("S15", s15.before, s15.after);
  assertSnap("S15 after", s15.after, {
    pendingExists: true,
    meterType: "horometro",
    patente: "AG382QB",
    activeExpectation: "km",
  });
  assert.equal(s15.before.patente, s15.after.patente, "S15 misma patente");
  assert.equal(s15.before.meterType, "horometro");
  assert.equal(s15.after.meterType, "horometro");
  assert.equal(s15.before.activeExpectation, "km");
  assert.equal(s15.after.activeExpectation, "km");
  assert.doesNotMatch(
    s15.result.message,
    /¿de qué unidad|pasame la \*patente\*/i,
    "S15 no pide unidad nuevamente",
  );
  assert.match(s15.result.message, /hs|hor[oó]metro|valor/i);
  assertNoWrites("S15");
}

console.log("\n========== NÚMEROS AMBIGUOS ==========");
await resetState();
{
  await turn("N1", "Quiero cambiar el horómetro");
  const n2 = await turn("N2 unit expect", "900121");
  assert.equal(n2.after.activeExpectation, "km");
  assert.equal(String(n2.after.patente ?? "").replace(/\s+/g, "").toUpperCase(), "AG382QB");

  const n3 = await turn("N3 value expect", "121988");
  assert.equal(n3.result.executor, "odometro");
  assert.equal(n3.after.horometro, 121988);
  assert.equal(n3.after.activeExpectation, "fecha_hora", "N3 espera fecha/hora");

  const n5 = await turn("N5 fecha expect + number", "121988");
  assert.equal(n5.result.executor, "odometro");
  assert.doesNotMatch(n5.result.message, /unidad no encontrada|coincida con/i);
  assert.ok(
    /fecha|hora|formato|confirmo/i.test(n5.result.message) ||
      n5.after.activeExpectation === "fecha_hora" ||
      n5.after.activeExpectation === "confirmo",
    "N5 no busca unidad; pide formato o sigue trámite",
  );
  assertNoWrites("N5");
}
await resetState();
{
  const lone = await turn("N6 sin trámite", "121988");
  assert.ok(
    lone.result.executor !== "odometro" ||
      !/confirmo|voy a registrar/i.test(lone.result.message),
    "sin trámite no asume km automáticamente hacia escritura",
  );
  assertNoWrites("N6");
}

console.log("\n========== CONTINUIDAD / LATERALES ==========");
await resetState();
{
  await turn("L1", "Quiero cambiar el horómetro");
  await turn("L2", "900121");
  const beforeGps = await getPendingAction(prisma, PHONE);
  assert.equal(readAuthoritativeMeterType(beforeGps), "horometro");

  const gps = await turn("L3 GPS", "Estado GPS de AG 382 QB");
  assert.ok(
    gps.result.executor === "unidades" ||
      /gps|reporte|ignici|posici|lat|lon|offline|online/i.test(gps.result.message),
    "GPS responde consulta",
  );
  const afterGps = await getPendingAction(prisma, PHONE);
  assert.equal(readAuthoritativeMeterType(afterGps), "horometro", "GPS conserva horómetro");

  const resume = await turn("L4 resume value", "121988");
  assert.equal(resume.result.executor, "odometro");
  assert.equal(resume.after.horometro, 121988);
  assertNoWrites("L4");
}
await resetState();
{
  await turn("C1", "Quiero cambiar el horómetro");
  await turn("C2", "900121");
  const cert = await turn("C3 cert", "Necesito el certificado de cobertura");
  assert.ok(
    cert.after.activeExpectation === "fork_choice" ||
      cert.result.executor === "certificados" ||
      /certificado|cobertura|fork|requerimiento|cambiar de requerimiento/i.test(cert.result.message),
    "certificado pivota o abre fork (no vuelve solo a horómetro valor)",
  );
  assertNoWrites("C3");
}
await resetState();
{
  await turn("M1", "Quiero cambiar el horómetro");
  await turn("M2", "900121");
  const maint = await turn("M3 maint", "Mantenimiento");
  assert.ok(
    maint.after.activeExpectation === "fork_choice" ||
      maint.result.executor === "info_guides" ||
      maint.result.executor === "mantenimiento" ||
      /mantenimiento|app|utilidades|requerimiento|cambiar de requerimiento/i.test(
        maint.result.message,
      ),
    "mantenimiento no contamina medidor hacia escritura",
  );
  assert.doesNotMatch(maint.result.message, /listo,\s*registr/i);
  assertNoWrites("M3");
}
await resetState();
{
  await turn("E1", "Quiero cambiar el horómetro");
  await turn("E2", "900121");
  const emp = await turn("E3 empresa", "cambiar empresa");
  assert.doesNotMatch(emp.result.message, /listo,\s*registr/i);
  assert.ok(
    emp.after.horometro == null || emp.after.meterType === "horometro",
    "cambiar empresa no se consume como valor del medidor",
  );
  assertNoWrites("E3");
}

console.log("\n========== RESUMEN TRANSCRIPT ==========");
for (const row of transcript) {
  console.log(
    JSON.stringify({
      label: row.label,
      inbound: row.inbound,
      executor: row.executor,
      meterType: row.after.meterType,
      activeExpectation: row.after.activeExpectation,
      patente: row.after.patente,
      writes: row.externalWrites,
      outbound: row.outbound.slice(0, 120),
    }),
  );
}

assert.equal(externalWrites, 0, "cero escrituras externas al final");
await prisma.$disconnect();
console.log("\n✅ verify-meter-flow-authority-agent-e2e OK (WARA_AGENT_MODE=true, sin sembrar pending)");
