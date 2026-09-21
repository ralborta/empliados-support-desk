#!/usr/bin/env node
/**
 * E2E autoridad medidores: policy → executor → handler odometro-horometro + DB.
 *
 * A. Horometro 900119 → 77 → fecha pasada → resumen horómetro CONFIRMO
 * B. Horometro → Estado GPS → 77 → sigue horómetro, meterType intacto
 * C. Horometro → 77 → fecha futura → error + pending intacto
 * D. Historial certificado sin pending → Estado GPS → executor=unidades
 * E. Certificado explícito durante horómetro → fork + restauración al seguir
 *
 * Uso: npx tsx scripts/verify-meter-authority-continuity-e2e.mjs
 */
import assert from "node:assert/strict";

process.env.BUILDERBOT_CONTEXT_API_KEY =
  process.env.BUILDERBOT_CONTEXT_API_KEY || "test-meter-authority-key";
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "false";
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
requireDatabaseUrl("verify-meter-authority-continuity-e2e");
loadVerifyEnv();

const API_KEY = process.env.BUILDERBOT_CONTEXT_API_KEY;
const PHONE = "5490000000997";

const FLEET = [
  {
    unidad: "M900-119",
    patente: "AG228NZ",
    movil_id: 900119,
    ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 30 },
    ultima_ignicion: { estado: false, fecha: new Date().toISOString() },
    ultima_posicion: { lat: -34.6, lon: -58.4, fecha: new Date().toISOString() },
  },
  {
    unidad: "M900-100",
    patente: "AH652KW",
    movil_id: 900100,
    ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 20 },
    ultima_ignicion: { estado: true, fecha: new Date().toISOString() },
    ultima_posicion: { lat: -34.61, lon: -58.41, fecha: new Date().toISOString() },
  },
  {
    unidad: "M900-110",
    patente: "AG382QB",
    movil_id: 900110,
    ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 10 },
    ultima_ignicion: { estado: true, fecha: new Date().toISOString() },
    ultima_posicion: { lat: -34.62, lon: -58.42, fecha: new Date().toISOString() },
  },
];

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (/ObtenerContactosPorNumero/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        encontrado: true,
        contactos: [{ id: 131776, empresa: "El Cacique S.A.", nombre: "Test" }],
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
  if (/ConsultarEstadoUnidades|ListarUnidades|ValidarPatente|flota|odometro|horometro/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: FLEET,
        message: "ok",
      }),
    };
  }
  return { ok: false, status: 404, json: async () => ({ error: "not mocked" }) };
};

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { setPendingAction, clearPendingAction, getPendingAction } = await import(
  "../src/lib/pendingAction.ts"
);
const { setActiveUnit, clearActiveUnit } = await import("../src/lib/activeUnit.ts");
const { readTurnLayer } = await import("../src/lib/turnLayerContract.ts");

async function ensureCustomer() {
  const existing = await prisma.customer.findUnique({ where: { phone: PHONE } });
  if (existing) return existing;
  return prisma.customer.create({
    data: {
      phone: PHONE,
      name: "Meter Authority E2E",
      companyName: "El Cacique S.A.",
    },
  });
}

async function resetState() {
  await clearPendingAction(prisma, PHONE);
  await clearActiveUnit(prisma, PHONE).catch(() => undefined);
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { customer: { phone: PHONE } } },
  }).catch(() => undefined);
}

function horoPending(extra = {}) {
  return {
    summary: "Horómetro AG228NZ — pasame hs",
    payload: {
      stage: "collecting",
      meterType: "horometro",
      patente: "AG228NZ",
      turnLayer: {
        activeExpectation: "km",
        pausedExpectation: null,
        forkPending: false,
      },
      ...extra,
    },
  };
}

function assertPendingShape(pending, expect) {
  assert.ok(pending, "pending debe existir");
  assert.equal(pending.type, expect.type, `type=${pending.type}`);
  const p = pending.payload ?? {};
  if (expect.meterType !== undefined) {
    assert.equal(
      String(p.meterType ?? "").toLowerCase(),
      expect.meterType,
      `meterType=${p.meterType}`,
    );
  }
  if (expect.patente !== undefined) {
    assert.equal(
      String(p.patente ?? "").replace(/\s+/g, "").toUpperCase(),
      expect.patente.replace(/\s+/g, "").toUpperCase(),
      `patente=${p.patente}`,
    );
  }
  if (expect.valor !== undefined) {
    const got =
      expect.meterType === "horometro" || p.meterType === "horometro"
        ? p.horometro
        : p.odometro;
    assert.equal(got, expect.valor, `valor=${got}`);
  }
  if (expect.stage !== undefined) {
    assert.equal(p.stage, expect.stage, `stage=${p.stage}`);
  }
  const layer = readTurnLayer(pending);
  if (expect.activeExpectation !== undefined) {
    assert.equal(
      layer?.activeExpectation ?? null,
      expect.activeExpectation,
      `activeExpectation=${layer?.activeExpectation}`,
    );
  }
  if (expect.forkPending !== undefined) {
    assert.equal(
      Boolean(layer?.forkPending),
      expect.forkPending,
      `forkPending=${layer?.forkPending}`,
    );
  }
}

function snapshotOperational(pending) {
  const p = pending?.payload ?? {};
  const layer = readTurnLayer(pending);
  return {
    type: pending?.type ?? null,
    meterType: p.meterType ?? null,
    patente: p.patente ?? null,
    odometro: p.odometro ?? null,
    horometro: p.horometro ?? null,
    fecha: p.fecha ?? null,
    stage: p.stage ?? null,
    activeExpectation: layer?.activeExpectation ?? null,
    forkPending: Boolean(layer?.forkPending),
    pendingClarification: layer?.pendingClarification ?? null,
  };
}

function assertXorInvariants(pending, label) {
  const p = pending?.payload ?? {};
  const meter = String(p.meterType ?? "").toLowerCase();
  if (meter === "horometro") {
    assert.ok(
      p.odometro === undefined || p.odometro === null,
      `${label}: horómetro no debe tener odometro residual (${p.odometro})`,
    );
  }
  if (meter === "odometro") {
    assert.ok(
      p.horometro === undefined || p.horometro === null,
      `${label}: odómetro no debe tener horometro residual (${p.horometro})`,
    );
  }
  const layer = readTurnLayer(pending);
  if (!layer) return;
  const exp = layer.activeExpectation;
  if (exp === "fork_choice") {
    assert.equal(layer.forkPending, true, `${label}: fork_choice ⇒ forkPending`);
    assert.equal(layer.pendingClarification ?? null, null, `${label}: fork XOR clarif`);
  } else if (exp === "clarification") {
    assert.equal(Boolean(layer.forkPending), false, `${label}: clarification ⇒ !forkPending`);
  } else if (exp === "km" || exp === "fecha_hora" || exp === "confirmo" || exp === "unit") {
    assert.equal(Boolean(layer.forkPending), false, `${label}: campo operativo ⇒ !forkPending`);
    assert.equal(layer.pendingClarification ?? null, null, `${label}: campo operativo XOR clarif`);
  }
}

async function turn(text) {
  return runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: text,
    apiKey: API_KEY,
  });
}

const {
  persistOdometerPendingState,
  applyMeterValueXor,
  applyTurnLayerXor,
} = await import("../src/lib/odometerPendingAuthority.ts");

await ensureCustomer();
await resetState();

console.log("=== A: 77 + fecha pasada → resumen horómetro CONFIRMO ===");
{
  await setPendingAction(prisma, PHONE, "odometro", horoPending());
  await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });

  const r77 = await turn("77");
  assert.equal(r77.executor, "odometro", `A.77 executor=${r77.executor}`);
  assert.ok(/hor[oó]metro/i.test(r77.message), `A.77 copy horómetro: ${r77.message.slice(0, 120)}`);
  assert.ok(!/\b77\s*km\b/i.test(r77.message), "A.77 no debe decir km");
  const after77 = await getPendingAction(prisma, PHONE);
  assertPendingShape(after77, {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    valor: 77,
    activeExpectation: "fecha_hora",
    forkPending: false,
  });
  assertXorInvariants(after77, "A.77");

  const rFecha = await turn("01/01/2025 14:30");
  assert.equal(rFecha.executor, "odometro", `A.fecha executor=${rFecha.executor}`);
  assert.ok(/CONFIRMO/i.test(rFecha.message), `A.fecha CONFIRMO: ${rFecha.message.slice(0, 200)}`);
  assert.ok(/hor[oó]metro/i.test(rFecha.message), "A.fecha label horómetro");
  assert.ok(/\b77\b/.test(rFecha.message) && !/\b77\s*km\b/i.test(rFecha.message), "A.fecha 77 hs");
  const afterFecha = await getPendingAction(prisma, PHONE);
  assertPendingShape(afterFecha, {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    valor: 77,
    activeExpectation: "confirmo",
    forkPending: false,
  });
  assertXorInvariants(afterFecha, "A.fecha");
}

await resetState();
console.log("=== B: GPS overlay → 77 sigue horómetro ===");
{
  await setPendingAction(prisma, PHONE, "odometro", horoPending());
  await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });

  const gps = await turn("Estado 900100");
  assert.ok(gps.message, "B.GPS responde");
  const afterGps = await getPendingAction(prisma, PHONE);
  assertPendingShape(afterGps, {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    activeExpectation: "km",
    forkPending: false,
  });
  assert.equal(gps.executor, "odometro", `B.GPS overlay label=${gps.executor}`);

  const r77 = await turn("77");
  assert.equal(r77.executor, "odometro");
  assert.ok(/hor[oó]metro/i.test(r77.message) || /\b77\b/.test(r77.message), r77.message.slice(0, 160));
  assert.ok(!/\bod[oó]metro\b.*\b77\b|\b77\s*km\b/i.test(r77.message), "B.77 no odómetro/km");
  const after77 = await getPendingAction(prisma, PHONE);
  assertPendingShape(after77, {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    valor: 77,
    activeExpectation: "fecha_hora",
    forkPending: false,
  });
  assertXorInvariants(after77, "B.77");
}

await resetState();
console.log("=== C: fecha futura → rechazo + fecha NO persistida + snapshot operativo ===");
{
  await setPendingAction(
    prisma,
    PHONE,
    "odometro",
    horoPending({
      horometro: 77,
      fecha: "2025-01-01T14:30:00",
      turnLayer: { activeExpectation: "fecha_hora", forkPending: false },
      stage: "missing_fecha_hora",
    }),
  );
  await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });
  const before = await getPendingAction(prisma, PHONE);
  const snapBefore = snapshotOperational(before);
  assert.equal(snapBefore.fecha, "2025-01-01T14:30:00");
  assert.equal(snapBefore.horometro, 77);
  assert.equal(snapBefore.odometro, null);

  const r = await turn("01/01/2099 10:00");
  assert.equal(r.executor, "odometro");
  assert.ok(/futur|posterior/i.test(r.message), `C.error: ${r.message.slice(0, 180)}`);
  assert.ok(/hor[oó]metro/i.test(r.message), "C.copy dice horómetro");
  const after = await getPendingAction(prisma, PHONE);
  assert.ok(after, "C.pending no se borró");
  const snapAfter = snapshotOperational(after);
  assert.equal(snapAfter.type, snapBefore.type);
  assert.equal(snapAfter.meterType, "horometro");
  assert.equal(snapAfter.patente, snapBefore.patente);
  assert.equal(snapAfter.horometro, 77);
  assert.equal(snapAfter.odometro, null);
  assert.equal(snapAfter.activeExpectation, "fecha_hora");
  assert.equal(snapAfter.forkPending, false);
  // Fecha futura rechazada NO debe quedar en payload; se conserva la previa válida.
  assert.equal(snapAfter.fecha, "2025-01-01T14:30:00", "C.conserva fecha válida previa");
  assert.ok(
    !String(snapAfter.fecha ?? "").includes("2099"),
    "C.fecha futura 2099 no persistida",
  );
  assertXorInvariants(after, "C");
}

await resetState();
console.log("=== C2: fecha futura sin fecha previa → fecha ausente ===");
{
  await setPendingAction(
    prisma,
    PHONE,
    "odometro",
    horoPending({
      horometro: 77,
      turnLayer: { activeExpectation: "fecha_hora", forkPending: false },
      stage: "missing_fecha_hora",
    }),
  );
  const before = snapshotOperational(await getPendingAction(prisma, PHONE));
  assert.equal(before.fecha, null);
  await turn("01/01/2099 10:00");
  const after = snapshotOperational(await getPendingAction(prisma, PHONE));
  assert.equal(after.fecha, null, "C2.fecha sigue ausente");
  assert.equal(after.horometro, 77);
  assert.equal(after.meterType, "horometro");
  assert.equal(after.activeExpectation, "fecha_hora");
}

await resetState();
console.log("=== D: historial certificado stale → GPS = unidades ===");
{
  const { resolveTurnExecutor } = await import("../src/lib/whatsappTurnClassifierAI.ts");
  const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");
  const certThread = [
    "Cliente: certificado AG 382 QD",
    "Atilio: 📋 *Confirmar certificado*",
    "Unidad AG 382 QD",
    "Respondé CONFIRMO para enviar.",
  ].join("\n");

  const pending = await getPendingAction(prisma, PHONE);
  assert.equal(pending, null, "D.sin pending vivo");

  const rules = classifyTurnExecutor("Estado 900110", certThread, null);
  assert.equal(rules, "unidades", `D.rules=${rules}`);

  const resolved = await resolveTurnExecutor("Estado 900110", certThread, null);
  assert.equal(resolved.executor, "unidades", `D.resolve=${resolved.executor}/${resolved.ruleId}`);

  const gps = await turn("Estado 900110");
  assert.equal(gps.executor, "unidades", `D.phase executor=${gps.executor}`);
  assert.ok(gps.message, "D.GPS responde");
  assert.ok(!/confirmar certificado|Respondé CONFIRMO/i.test(gps.message), "D.no certificado");
  const after = await getPendingAction(prisma, PHONE);
  assert.equal(after, null, "D.sigue sin pending write");
}

await resetState();
console.log("=== E: certificado durante horómetro → fork + seguir restaura ===");
{
  await setPendingAction(prisma, PHONE, "odometro", horoPending({ horometro: 77 }));
  await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });

  const fork = await turn("quiero el certificado");
  assert.ok(/seguir|certificado|paus/i.test(fork.message), fork.message.slice(0, 200));
  const afterFork = await getPendingAction(prisma, PHONE);
  assert.equal(afterFork?.type, "odometro", "E.pending type sigue odometro durante fork");
  const layerFork = readTurnLayer(afterFork);
  assert.equal(layerFork?.forkPending, true, "E.forkPending=true");
  assertXorInvariants(afterFork, "E.fork");
  assert.equal(
    String(afterFork?.payload?.meterType ?? "").toLowerCase(),
    "horometro",
    "E.meterType intacto en fork",
  );

  const seguir = await turn("seguir");
  assert.ok(seguir.message, "E.seguir responde");
  const afterSeguir = await getPendingAction(prisma, PHONE);
  assertPendingShape(afterSeguir, {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    valor: 77,
    forkPending: false,
  });
  assertXorInvariants(afterSeguir, "E.seguir");
}

await resetState();
console.log("=== F: fallo simulado de persistencia tras 77 ===");
{
  await setPendingAction(prisma, PHONE, "odometro", horoPending());
  await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });
  const before = snapshotOperational(await getPendingAction(prisma, PHONE));
  assert.equal(before.horometro, null);

  process.env.WARA_ODOMETER_FORCE_PERSIST_FAIL = "1";
  try {
    const r = await turn("77");
    assert.equal(r.executor, "odometro");
    assert.match(
      r.message,
      /problema guardando|pending_action_persist_failed|repetirme/i,
      `F.mensaje seguro: ${r.message.slice(0, 160)}`,
    );
    assert.ok(!/valor anotado|me falta|CONFIRMO/i.test(r.message), "F.no promete continuidad");
    const after = snapshotOperational(await getPendingAction(prisma, PHONE));
    assert.equal(after.horometro, null, "F.77 no persistido");
    assert.equal(after.meterType, "horometro");
    assert.equal(after.activeExpectation, "km");
    assert.equal(after.patente, before.patente);
  } finally {
    delete process.env.WARA_ODOMETER_FORCE_PERSIST_FAIL;
  }
}

await resetState();
console.log("=== G: persist sin meterType ni pending → no crea odómetro ===");
{
  const ok = await persistOdometerPendingState({
    prisma,
    phone: PHONE,
    summary: "should fail",
    payloadPatch: { patente: "AG228NZ" },
    activeExpectation: "km",
    stage: "collecting",
  });
  assert.equal(ok, false, "G.persist debe fallar");
  const pending = await getPendingAction(prisma, PHONE);
  assert.equal(pending, null, "G.no crea pending con default odómetro");
}

console.log("=== H: XOR unitarios meterType / turnLayer ===");
{
  const horoXor = applyMeterValueXor(
    { odometro: 1000, horometro: 77, meterType: "horometro" },
    "horometro",
  );
  assert.equal(horoXor.horometro, 77);
  assert.equal("odometro" in horoXor, false);
  const odoXor = applyMeterValueXor(
    { odometro: 1000, horometro: 77, meterType: "odometro" },
    "odometro",
  );
  assert.equal(odoXor.odometro, 1000);
  assert.equal("horometro" in odoXor, false);

  const forkLayer = applyTurnLayerXor({}, "fork_choice");
  assert.equal(forkLayer.forkPending, true);
  assert.equal(forkLayer.pendingClarification, null);
  const kmLayer = applyTurnLayerXor(
    { forkPending: true, pendingClarification: { kind: "unit_ref_action" } },
    "km",
  );
  assert.equal(kmLayer.forkPending, false);
  assert.equal(kmLayer.pendingClarification, null);
}

await resetState();
console.log("=== SMOKE: Horometro→GPS→77→fecha pasada→CONFIRMO ===");
{
  await setPendingAction(prisma, PHONE, "odometro", horoPending());
  await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });

  const gps = await turn("Estado 900100");
  assert.ok(gps.message, "smoke GPS");
  assertPendingShape(await getPendingAction(prisma, PHONE), {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    activeExpectation: "km",
    forkPending: false,
  });

  const r77 = await turn("77");
  assert.ok(/77/i.test(r77.message) && /hor[oó]metro/i.test(r77.message), r77.message.slice(0, 160));
  assertPendingShape(await getPendingAction(prisma, PHONE), {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    valor: 77,
    activeExpectation: "fecha_hora",
    forkPending: false,
  });

  const past = await turn("01/01/2025 14:30");
  assert.ok(/CONFIRMO/i.test(past.message), past.message.slice(0, 200));
  assert.ok(/hor[oó]metro/i.test(past.message), "smoke label horómetro");
  const after = await getPendingAction(prisma, PHONE);
  assertPendingShape(after, {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    valor: 77,
    activeExpectation: "confirmo",
    forkPending: false,
  });
  assertXorInvariants(after, "smoke-past");
}

await resetState();
console.log("=== SMOKE: fecha futura → rechazo → corrección → CONFIRMO ===");
{
  await setPendingAction(
    prisma,
    PHONE,
    "odometro",
    horoPending({
      horometro: 77,
      turnLayer: { activeExpectation: "fecha_hora", forkPending: false },
      stage: "missing_fecha_hora",
    }),
  );
  await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });

  const fut = await turn("01/01/2099 10:00");
  assert.ok(/futur|posterior/i.test(fut.message), fut.message.slice(0, 160));
  const afterFut = snapshotOperational(await getPendingAction(prisma, PHONE));
  assert.equal(afterFut.fecha, null, "smoke futura: fecha ausente");
  assert.equal(afterFut.horometro, 77);
  assert.equal(afterFut.activeExpectation, "fecha_hora");

  const fix = await turn("01/01/2025 14:30");
  assert.ok(/CONFIRMO/i.test(fix.message), fix.message.slice(0, 200));
  assert.ok(/hor[oó]metro/i.test(fix.message));
  const afterFix = await getPendingAction(prisma, PHONE);
  assertPendingShape(afterFix, {
    type: "odometro",
    meterType: "horometro",
    patente: "AG228NZ",
    valor: 77,
    activeExpectation: "confirmo",
    forkPending: false,
  });
  assert.ok(afterFix.payload?.fecha, "smoke corrección persiste fecha válida");
  assert.ok(!String(afterFix.payload.fecha).includes("2099"));
  assertXorInvariants(afterFix, "smoke-fix");
}

await resetState();
globalThis.fetch = originalFetch;
await prisma.$disconnect();
console.log("OK verify-meter-authority-continuity-e2e");
