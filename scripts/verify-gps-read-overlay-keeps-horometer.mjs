#!/usr/bin/env node
/**
 * Política read/write V1 + integración persistida + regresiones + concurrencia.
 *
 * Uso: npx tsx scripts/verify-gps-read-overlay-keeps-horometer.mjs
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

process.env.BUILDERBOT_CONTEXT_API_KEY =
  process.env.BUILDERBOT_CONTEXT_API_KEY || "test-gps-overlay-key";
process.env.WARA_UTTERANCE_UNDERSTANDING = "false";
process.env.WARA_AGENT_MODE = "false";
process.env.WARA_TURN_BACKEND_SEND = "false";
process.env.WARA_INBOUND_AUDIT_ONLY = "true";
process.env.WARA_OBTENER_EMPRESA_TOKEN =
  process.env.WARA_OBTENER_EMPRESA_TOKEN || "test-empresa-token";
process.env.WARA_API_BASE_URL = "https://wara.test.local";
process.env.WARA_MAINTENANCE_API_BASE_URL = "https://wara-maint.test.local";
process.env.NODE_ENV = "test";

const API_KEY = process.env.BUILDERBOT_CONTEXT_API_KEY;
const PHONE = "5490000000888";

const {
  decidePendingWriteInterference,
  actionRiskFromTypedLateralKind,
  buildDeclarativePendingWriteResumeHint,
  composeOverlayReadKeepPendingReply,
  fingerprintV1PendingWriteState,
  fingerprintsDeepEqual,
} = await import("../src/lib/pendingWriteInterference.ts");

const {
  isExplicitUnitStatusQuery,
  isOperationalMeterCollectionMessage,
} = await import("../src/lib/tramiteMeterPrecedence.ts");

const {
  shouldInterpretAmbiguousUtterance,
  actionRiskFromUnderstanding,
  shouldClarifyUnitWithoutStatusAction,
} = await import("../src/lib/utteranceUnderstanding.ts");

const {
  classifyTypedLateralQuery,
  shouldSkipTypedLateralForOdometerFlow,
} = await import("../src/lib/typedLateralQueries.ts");

const {
  buildPivotIntentFromStatusText,
  extractTramiteUnitAnchorFromThread,
  pivotTargetsSameTramiteUnit,
  prepareStatusPivotDuringTramite,
} = await import("../src/lib/tramitePivot.ts");

const { looksLikeExplicitOtherTramiteIntent } = await import("../src/lib/turnLayerContract.ts");
const { looksLikeBareMeterValue } = await import("../src/lib/wara.ts");
const {
  buildFleetUnitNotFoundMessage,
  findNearbyFleetUnits,
} = await import("../src/lib/waraUnitIntent.ts");

const threadHoroNkl952 = [
  "Cliente: Ok ahora cambio de horometro",
  "Atilio: ⏱ *Horómetro*",
  "",
  "🚗 *Unidad:* NKL 952",
  "",
  "📋 *Datos operativos del horómetro*",
  "Pasame el nuevo horómetro en horas y la fecha/hora de la lectura.",
].join("\n");

const pendingHorometerNkl952 = {
  type: "odometro",
  createdAt: new Date().toISOString(),
  payload: {
    stage: "collecting",
    meterKind: "horometro",
    plate: "NKL952",
    turnLayer: { activeExpectation: "km", pausedExpectation: null, forkPending: false },
  },
};

const activeUnitNkl952 = {
  plate: "NKL952",
  label: "NKL 952",
  source: "odometro",
  resolvedAt: "2026-08-23T22:50:00.000Z",
};

const caciqueFleet = [
  { unidad: "M900-100", patente: "AH 652 KW", movil_id: 151018, marca: "Mercedes", modelo: "Atego" },
  { unidad: "M900-121", patente: "AG 382 QB", movil_id: 101152, marca: "Mercedes", modelo: "Atego" },
];

console.log("=== Policy + regresiones semánticas ===");
assert.equal(
  decidePendingWriteInterference({
    hasPendingWrite: true,
    incomingActionRisk: "read",
    incomingMatchesExpectedField: false,
  }),
  "overlay_read_keep_pending",
);
assert.equal(actionRiskFromTypedLateralKind("gps_unit_status"), "read");

assert.equal(
  actionRiskFromUnderstanding({
    referent: "vehicle_unit",
    confidence: 0.9,
    clarifyQuestion: null,
    action: "unit_reference",
    unitRef: { kind: "unit_name", value: "900121" },
  }),
  null,
  "referencia de unidad sin pedir estado → no GPS",
);
assert.equal(
  shouldClarifyUnitWithoutStatusAction({
    referent: "vehicle_unit",
    confidence: 0.9,
    clarifyQuestion: null,
    action: "unit_reference",
    unitRef: { kind: "unit_name", value: "900121" },
  }),
  true,
);
assert.equal(
  actionRiskFromUnderstanding({
    referent: "vehicle_unit",
    confidence: 0.9,
    clarifyQuestion: null,
    action: "unit_correction",
    unitRef: { kind: "unit_name", value: "900100" },
  }),
  null,
  "corrección de unidad → no GPS",
);
assert.equal(
  actionRiskFromUnderstanding({
    referent: "vehicle_unit",
    confidence: 0.95,
    clarifyQuestion: null,
    action: "unit_status_read",
    unitRef: { kind: "unit_name", value: "900121" },
  }),
  "read",
  "typo/status semántico → read",
);
assert.equal(
  decidePendingWriteInterference({
    hasPendingWrite: true,
    incomingActionRisk: "read",
    incomingMatchesExpectedField: false,
  }),
  "overlay_read_keep_pending",
);
assert.equal(
  actionRiskFromUnderstanding({
    referent: "new_request",
    confidence: 0.9,
    clarifyQuestion: null,
    action: "new_write",
    unitRef: { kind: "unit_name", value: "900100" },
  }),
  "write",
);
assert.equal(
  decidePendingWriteInterference({
    hasPendingWrite: true,
    incomingActionRisk: "write",
    incomingMatchesExpectedField: false,
  }),
  "fork_incompatible_write",
  "nueva escritura → fork",
);

assert.equal(isExplicitUnitStatusQuery("Estado 900100"), true);
assert.equal(classifyTypedLateralQuery("Estado 900100"), "gps_unit_status");
assert.equal(shouldSkipTypedLateralForOdometerFlow("Estado 900100", threadHoroNkl952), false);
assert.equal(looksLikeBareMeterValue("4521"), true);
assert.equal(isOperationalMeterCollectionMessage("4521", threadHoroNkl952), true);
assert.equal(shouldInterpretAmbiguousUtterance("Estrado 900121", threadHoroNkl952), true);
assert.equal(shouldInterpretAmbiguousUtterance("4521", threadHoroNkl952), false);
assert.equal(looksLikeExplicitOtherTramiteIntent("Certificado 900100"), "certificados");

const tramite = extractTramiteUnitAnchorFromThread(threadHoroNkl952);
assert.ok(tramite);
const pivotSame = buildPivotIntentFromStatusText("Estado de NKL 952", 42);
assert.ok(pivotSame);
assert.equal(pivotTargetsSameTramiteUnit(tramite, pivotSame), true);

const composed = composeOverlayReadKeepPendingReply(
  "Telemetría ok.",
  buildDeclarativePendingWriteResumeHint({
    meterKind: "horometro",
    plateDisplay: "NKL 952",
    writeKind: "odometro",
  }),
);
assert.doesNotMatch(composed, /¿seguimos/i);

console.log("=== prepareStatusPivot (falla = suite falla) ===");
const pivotPrep = await prepareStatusPivotDuringTramite({
  prisma: {
    customer: {
      findFirst: async () => ({
        id: "c1",
        phone: PHONE,
        selectedCompanyContactId: 42,
        companyName: "El Cacique S.A.",
      }),
      findUnique: async () => null,
      update: async () => ({}),
    },
  },
  rawPhone: PHONE,
  selectionText: "Estado 900100",
  threadText: threadHoroNkl952,
  pendingAction: pendingHorometerNkl952,
});
assert.ok(pivotPrep, "prepareStatusPivot debe resolver");
assert.notEqual(pivotPrep.kind, "fork");
assert.ok(
  pivotPrep.kind === "overlay_read" || pivotPrep.kind === "same_unit_lateral",
  `got ${pivotPrep.kind}`,
);

// --- Mock DB + fetch Wara ---
const customerData = {
  id: "cust-overlay-int",
  phone: PHONE,
  name: "Test Overlay",
  companyName: "El Cacique S.A.",
  selectedCompanyContactId: 42,
  pendingAction: structuredClone(pendingHorometerNkl952),
  activeUnit: structuredClone(activeUnitNkl952),
  waraSessionToken: "mock-session-token",
  waraSessionAt: new Date(),
  conversationNotebook: null,
};
const ticket = {
  id: "ticket-overlay-int",
  customerId: customerData.id,
  status: "OPEN",
  lastMessageAt: new Date(),
};
const messages = [];

function readWaMeta(row) {
  return row?.rawPayload?.waTurnDelivery ?? {};
}

function applyMockLedgerSql(sql, values) {
  if (sql.includes("FOR UPDATE")) return 1;
  if (!sql.includes("UPDATE")) return 0;
  const inboundId = values[1];
  const row = messages.find((m) => m.id === inboundId);
  if (!row) return 0;
  const meta = readWaMeta(row);
  const nextPayload = typeof values[0] === "string" ? JSON.parse(values[0]) : values[0];
  if (sql.includes("::bigint < $3")) {
    if (meta.waDeliveryState === "delivered") return 0;
    if (meta.waDeliveryState === "send_initiated" && meta.waOutboundProviderId) return 0;
    row.rawPayload = nextPayload;
    return 1;
  }
  const attemptId = values[2];
  if (meta.attemptId !== attemptId) return 0;
  row.rawPayload = nextPayload;
  return 1;
}

const mockPrisma = {
  customer: {
    findFirst: async () => customerData,
    findUnique: async ({ where } = {}) => {
      if (where?.id && where.id !== customerData.id) return null;
      if (where?.phone && String(where.phone) !== PHONE) return null;
      return customerData;
    },
    update: async ({ data }) => {
      if (data.pendingAction !== undefined) {
        customerData.pendingAction =
          data.pendingAction === Prisma.JsonNull ? null : data.pendingAction;
      }
      if (data.activeUnit !== undefined) {
        customerData.activeUnit =
          data.activeUnit === Prisma.JsonNull ? null : data.activeUnit;
      }
      if (data.conversationNotebook !== undefined) {
        customerData.conversationNotebook =
          data.conversationNotebook === Prisma.JsonNull ? null : data.conversationNotebook;
      }
      if (data.waraSessionToken !== undefined) {
        customerData.waraSessionToken = data.waraSessionToken;
      }
      if (data.waraSessionAt !== undefined) {
        customerData.waraSessionAt = data.waraSessionAt;
      }
      if (data.selectedCompanyContactId !== undefined) {
        customerData.selectedCompanyContactId = data.selectedCompanyContactId;
      }
      return customerData;
    },
  },
  ticket: {
    findFirst: async () => ticket,
    update: async () => ticket,
  },
  ticketMessage: {
    findMany: async () => [...messages],
    findFirst: async () => null,
    findUnique: async ({ where }) => messages.find((m) => m.id === where.id) ?? null,
    create: async ({ data }) => {
      const row = {
        id: data.id ?? `msg-${messages.length + 1}`,
        createdAt: new Date(),
        rawPayload: {},
        ...data,
      };
      messages.push(row);
      return row;
    },
    count: async () => messages.length,
  },
  $queryRaw: async () => [],
  $transaction: async (fn) => fn(mockPrisma),
  $executeRaw: async (strings, ...values) =>
    applyMockLedgerSql(Array.isArray(strings) ? strings.join("?") : String(strings), values),
  $executeRawUnsafe: async (sql, ...values) => applyMockLedgerSql(sql, values),
};

globalThis.prisma = mockPrisma;

let telemetryHits = 0;

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
        contactos: [{ id: 42, empresa: "El Cacique S.A.", nombre: "Test" }],
        SessionToken: "mock-session-token",
      }),
    };
  }
  if (/CreateChatBotToken/i.test(url)) {
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
  if (/ConsultarEstadoUnidades/i.test(url)) {
    telemetryHits += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        cliente: "El Cacique S.A.",
        unidades: [
          {
            unidad: "M900-100",
            patente: "AH652KW",
            movil_id: 151018,
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

const { getPendingAction } = await import("../src/lib/pendingAction.ts");
const { getActiveUnit } = await import("../src/lib/activeUnit.ts");
const { POST: unidadesPost } = await import("../src/app/api/wara/unidades/route.ts");

async function callUnidades(body) {
  const req = new NextRequest("http://internal/api/wara/unidades", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ from: PHONE, phone: PHONE, ...body }),
  });
  const res = await unidadesPost(req);
  return res.json();
}

console.log("=== Integración: DB mock → unidades ephemeral → fingerprint ===");
const fpBefore = fingerprintV1PendingWriteState({
  pendingAction: await getPendingAction(mockPrisma, PHONE),
  activeUnit: await getActiveUnit(mockPrisma, PHONE),
  tramiteUnitPlate: "NKL952",
});

const overlayRes = await callUnidades({
  rawText: "Estado 900100",
  ephemeralOverlayRead: true,
});
assert.ok(
  String(overlayRes.summaryText ?? overlayRes.message ?? "").length > 0 ||
    overlayRes.ok === false,
  "unidades respondió (ok o error Wara controlado)",
);

const fpAfterOverlay = fingerprintV1PendingWriteState({
  pendingAction: await getPendingAction(mockPrisma, PHONE),
  activeUnit: await getActiveUnit(mockPrisma, PHONE),
  tramiteUnitPlate: "NKL952",
});
assert.equal(
  fingerprintsDeepEqual(fpBefore, fpAfterOverlay),
  true,
  "fingerprint persistido idéntico tras overlay",
);
assert.equal(customerData.activeUnit?.plate, "NKL952");
assert.equal(customerData.pendingAction?.payload?.plate, "NKL952");

console.log("=== Early returns ephemeral → cero mutación ===");
const earlyCases = [
  { rawText: "quiero consultar por otra unidad", label: "anotherUnitConsult" },
  { rawText: "no era esa es otra", label: "explicitRejection" },
  { rawText: "tengo otras unidades que no reportan", label: "additionalMissing" },
];
for (const c of earlyCases) {
  customerData.pendingAction = structuredClone(pendingHorometerNkl952);
  customerData.activeUnit = structuredClone(activeUnitNkl952);
  const before = fingerprintV1PendingWriteState({
    pendingAction: await getPendingAction(mockPrisma, PHONE),
    activeUnit: await getActiveUnit(mockPrisma, PHONE),
    tramiteUnitPlate: "NKL952",
  });
  await callUnidades({ rawText: c.rawText, ephemeralOverlayRead: true });
  const after = fingerprintV1PendingWriteState({
    pendingAction: await getPendingAction(mockPrisma, PHONE),
    activeUnit: await getActiveUnit(mockPrisma, PHONE),
    tramiteUnitPlate: "NKL952",
  });
  assert.equal(
    fingerprintsDeepEqual(before, after),
    true,
    `early ${c.label}: cero mutación`,
  );
}

console.log("=== Concurrencia por teléfono: ver suite dedicada ===");
console.log(
  "RIESGO ARQUITECTÓNICO: no hay FIFO/mutex por teléfono. El ledger es por wamid,",
);
console.log(
  "no serializa turnos del mismo teléfono. Evidencia real:",
);
console.log("  npx tsx scripts/verify-gps-overlay-phone-concurrency.mjs");

const nearby = findNearbyFleetUnits(caciqueFleet, "M900-131");
assert.ok(nearby.length >= 1);
assert.match(
  buildFleetUnitNotFoundMessage({
    companyName: "El Cacique S.A.",
    searchedText: "M900-131",
    nearbyUnits: nearby,
    canSwitchCompany: true,
  }),
  /Coincidencias cercanas/i,
);

globalThis.fetch = originalFetch;

console.log("OK verify-gps-read-overlay-keeps-horometer");
