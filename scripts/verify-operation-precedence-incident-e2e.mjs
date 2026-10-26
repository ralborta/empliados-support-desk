#!/usr/bin/env node
/**
 * E2E precedencia: incidente Horometro→77→900119 + variantes naturales.
 *
 * Uso: npx tsx scripts/verify-operation-precedence-incident-e2e.mjs
 */
import assert from "node:assert/strict";

process.env.BUILDERBOT_CONTEXT_API_KEY =
  process.env.BUILDERBOT_CONTEXT_API_KEY || "test-op-precedence-key";
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "false";
process.env.WARA_TURN_BACKEND_SEND = "false";
process.env.WARA_INBOUND_AUDIT_ONLY = "true";
process.env.WARA_OBTENER_EMPRESA_TOKEN =
  process.env.WARA_OBTENER_EMPRESA_TOKEN || "test-empresa-token";
process.env.WARA_API_BASE_URL = "https://wara.test.local";
process.env.WARA_MAINTENANCE_API_BASE_URL = "https://wara-maint.test.local";
process.env.NODE_ENV = "test";

const { loadVerifyEnv, requireDatabaseUrl } = await import("./load-verify-env.mjs");
requireDatabaseUrl("verify-operation-precedence-incident-e2e");
loadVerifyEnv();

const API_KEY = process.env.BUILDERBOT_CONTEXT_API_KEY;
const PHONE = "5490000000991";

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
  if (/ConsultarEstadoUnidades|ListarUnidades|ValidarPatente|flota/i.test(url)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: [
          {
            unidad: "M900-119",
            patente: "AG228NZ",
            movil_id: 900119,
            ultimo_reporte: { fecha: new Date().toISOString(), hace_segundos: 30 },
            ultima_ignicion: { estado: false, fecha: new Date().toISOString() },
            ultima_posicion: { lat: -34.6, lon: -58.4, fecha: new Date().toISOString() },
          },
        ],
      }),
    };
  }
  return { ok: false, status: 404, json: async () => ({ error: "not mocked" }) };
};

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const { classifyOperationPrecedence } = await import("../src/lib/operationModuleAdapters.ts");
const { runTurnExecutorPhase } = await import("../src/lib/whatsappTurnExecutor.ts");
const { setPendingAction, clearPendingAction, getPendingAction } = await import(
  "../src/lib/pendingAction.ts"
);
const { setActiveUnit, clearActiveUnit } = await import("../src/lib/activeUnit.ts");

async function ensureCustomer() {
  const existing = await prisma.customer.findUnique({ where: { phone: PHONE } });
  if (existing) return existing;
  return prisma.customer.create({
    data: {
      phone: PHONE,
      name: "Precedence E2E",
      companyName: "El Cacique S.A.",
    },
  });
}

async function resetState() {
  await clearPendingAction(prisma, PHONE);
  await clearActiveUnit(prisma, PHONE).catch(() => undefined);
}

function horoPending(extra = {}) {
  return {
    summary: "Horómetro AG228NZ — pasame hs",
    payload: {
      stage: "collecting",
      meterType: "horometro",
      patente: "AG228NZ",
      turnLayer: { activeExpectation: "km", forkPending: false },
      ...extra,
    },
  };
}

console.log("=== Incidente: classify 77 / 900119 con pending horo ===");
{
  const pending = {
    type: "odometro",
    createdAt: new Date().toISOString(),
    ...horoPending(),
  };
  const t77 = classifyOperationPrecedence({
    pendingAction: pending,
    selectionText: "77",
    threadText: [
      "Horometro 900119",
      "⏱ *Horómetro*",
      "🚗 Unidad: *AG 228 NZ*",
      "🔢 Pasame el valor del horómetro en *hs* y la fecha y hora de la lectura.",
      "📋 *Confirmar certificado* (histórico viejo)",
      "Respondé CONFIRMO",
    ].join("\n"),
  });
  assert.equal(t77.decision, "continue_expected_field", "77 → continue");
  assert.equal(t77.authority.pendingOperation, "meter_horometro");
  assert.equal(t77.adapter?.executor, "odometro");

  const t900 = classifyOperationPrecedence({
    pendingAction: pending,
    selectionText: "900119",
    threadText: [
      "Horometro 900119",
      "⏱ *Horómetro* Unidad AG 228 NZ Pasame el valor del horómetro en hs",
      "77",
      "¿Cuál unidad? Pasame la matrícula completa… listado de mis unidades",
      "📋 *Confirmar certificado*",
    ].join("\n"),
  });
  assert.equal(t900.decision, "continue_expected_field", "900119 con km pending → continue meter");
  assert.notEqual(t900.adapter?.executor, "certificados");
  assert.equal(t900.authority.pendingOperation, "meter_horometro");
}

console.log("=== Variantes naturales (classify) ===");
{
  const pending = {
    type: "odometro",
    createdAt: new Date().toISOString(),
    ...horoPending(),
  };
  for (const text of ["77", "080", "350", "12"]) {
    const r = classifyOperationPrecedence({
      pendingAction: pending,
      selectionText: text,
      threadText: "",
    });
    assert.equal(r.decision, "continue_expected_field", `variante ${text}`);
  }

  const gps = classifyOperationPrecedence({
    pendingAction: pending,
    selectionText: "Estado 900110",
    threadText: "",
  });
  assert.equal(gps.decision, "overlay_read_keep_pending", `gps → ${gps.decision}`);
  assert.equal(gps.authority.incomingMatchesExpectedField, false, "GPS no es campo esperado");
  assert.equal(gps.authority.incomingActionRisk, "read");

  const fork = classifyOperationPrecedence({
    pendingAction: pending,
    selectionText: "quiero el certificado",
    threadText: "",
  });
  assert.equal(fork.decision, "fork_incompatible_write");
  assert.equal(fork.authority.incomingMatchesExpectedField, false);

  const bareNoPending = classifyOperationPrecedence({
    pendingAction: null,
    selectionText: "77",
    threadText: "📋 Confirmar certificado Respondé CONFIRMO",
  });
  assert.equal(bareNoPending.decision, "normal_route");
}

console.log("=== Executor phase: policy DB antes de legacy (no certificados) ===");
await ensureCustomer();
await resetState();

await setPendingAction(prisma, PHONE, "odometro", horoPending());
await setActiveUnit(prisma, PHONE, "AG228NZ", { source: "odometro" });

{
  const phase77 = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "77",
    apiKey: API_KEY,
  });
  assert.equal(phase77.executor, "odometro", `77 executor=${phase77.executor}`);
  assert.ok(
    !/confirmar certificado/i.test(phase77.message),
    "77 no debe abrir certificado",
  );
}

{
  await setPendingAction(prisma, PHONE, "odometro", horoPending());
  const phase900 = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "900119",
    apiKey: API_KEY,
  });
  assert.equal(phase900.executor, "odometro", `900119 executor=${phase900.executor}`);
  assert.ok(
    !/confirmar certificado/i.test(phase900.message),
    "900119 no debe confirmar certificado con pending meter+km",
  );
}

{
  await setPendingAction(prisma, PHONE, "odometro", horoPending());
  const before = await getPendingAction(prisma, PHONE);
  assert.equal(before?.type, "odometro");
  const gpsPhase = await runTurnExecutorPhase({
    rawPhone: PHONE,
    selectionText: "Estado 900110",
    apiKey: API_KEY,
  });
  const pendingAfterGps = await getPendingAction(prisma, PHONE);
  assert.equal(pendingAfterGps?.type, "odometro", "GPS overlay no pisa pending");
  assert.ok(gpsPhase.message, "GPS overlay responde");
  assert.ok(gpsPhase.executor === "unidades" || gpsPhase.executor === "odometro");
}

await resetState();
globalThis.fetch = originalFetch;
await prisma.$disconnect();
console.log("OK verify-operation-precedence-incident-e2e");
