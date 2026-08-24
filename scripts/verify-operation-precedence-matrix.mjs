#!/usr/bin/env node
/**
 * Matriz table-driven: precedencia general multi-módulo (alcance A).
 *
 * Write descriptors: odo / horo / cert / maint.
 * Read overlay: GPS/estado.
 * normal_route: empresa, guías, flota, tickets, soporte, menús (stateless/legacy).
 *
 * Uso: npx tsx scripts/verify-operation-precedence-matrix.mjs
 */
import assert from "node:assert/strict";

const {
  decideOperationPrecedence,
  isSemanticallyCompatibleField,
  buildOperationAuthority,
  assertOperationAuthorityInvariants,
} = await import("../src/lib/operationPrecedence.ts");

const {
  classifyOperationPrecedence,
  classifyStructuredIncomingField,
  OPERATION_MODULE_ADAPTERS,
} = await import("../src/lib/operationModuleAdapters.ts");

console.log("=== Alcance documentado: solo 4 writes + GPS read ===");
assert.deepEqual(Object.keys(OPERATION_MODULE_ADAPTERS).sort(), [
  "certificados",
  "mantenimiento",
  "meter_horometro",
  "meter_odometro",
]);

console.log("=== decideOperationPrecedence orden fijo ===");

/** @type {Array<[string, import("../src/lib/operationPrecedence.ts").OperationAuthority, string]>} */
const precedenceRows = [
  [
    "sin pending → normal",
    {
      pendingOperation: null,
      pendingStage: null,
      activeExpectation: null,
      incomingActionRisk: "read",
      incomingMatchesExpectedField: false,
      hasPendingClarification: false,
      pendingClarificationChoice: null,
      incomingStructuredClarification: true,
    },
    "normal_route",
  ],
  [
    "XOR clarif existente gana sobre read",
    {
      pendingOperation: "meter_horometro",
      pendingStage: "collecting",
      activeExpectation: "clarification",
      incomingActionRisk: "read",
      incomingMatchesExpectedField: false,
      hasPendingClarification: true,
      pendingClarificationChoice: "status",
      incomingStructuredClarification: false,
    },
    "resolve_pending_clarification",
  ],
  [
    "read explícito → overlay (match debe ser false)",
    {
      pendingOperation: "meter_horometro",
      pendingStage: "collecting",
      activeExpectation: "km",
      incomingActionRisk: "read",
      incomingMatchesExpectedField: false,
      hasPendingClarification: false,
      pendingClarificationChoice: null,
      incomingStructuredClarification: false,
    },
    "overlay_read_keep_pending",
  ],
  [
    "write → fork",
    {
      pendingOperation: "meter_horometro",
      pendingStage: "collecting",
      activeExpectation: "km",
      incomingActionRisk: "write",
      incomingMatchesExpectedField: false,
      hasPendingClarification: false,
      pendingClarificationChoice: null,
      incomingStructuredClarification: false,
    },
    "fork_incompatible_write",
  ],
  [
    "match sin risk → continue",
    {
      pendingOperation: "meter_horometro",
      pendingStage: "collecting",
      activeExpectation: "km",
      incomingActionRisk: null,
      incomingMatchesExpectedField: true,
      hasPendingClarification: false,
      pendingClarificationChoice: null,
      incomingStructuredClarification: false,
    },
    "continue_expected_field",
  ],
  [
    "apertura clarificación nueva",
    {
      pendingOperation: "certificados",
      pendingStage: "awaiting_unit",
      activeExpectation: "unit",
      incomingActionRisk: null,
      incomingMatchesExpectedField: false,
      hasPendingClarification: false,
      pendingClarificationChoice: null,
      incomingStructuredClarification: true,
    },
    "structured_clarification",
  ],
  [
    "sin match/risk/clarif → normal",
    {
      pendingOperation: "mantenimiento",
      pendingStage: "collecting",
      activeExpectation: "detail",
      incomingActionRisk: null,
      incomingMatchesExpectedField: false,
      hasPendingClarification: false,
      pendingClarificationChoice: null,
      incomingStructuredClarification: false,
    },
    "normal_route",
  ],
];

for (const [label, authority, expected] of precedenceRows) {
  assertOperationAuthorityInvariants(authority);
  assert.equal(decideOperationPrecedence(authority), expected, label);
}

console.log("=== invariantes match vs risk ===");
assert.equal(
  isSemanticallyCompatibleField({
    pendingOperation: "meter_horometro",
    activeExpectation: "km",
    structuredField: "meter_value",
    incomingActionRisk: "read",
  }),
  false,
  "read no puede matchear campo",
);
assert.equal(
  isSemanticallyCompatibleField({
    pendingOperation: "mantenimiento",
    activeExpectation: "detail",
    structuredField: "detail",
    incomingActionRisk: "write",
  }),
  false,
  "write no puede matchear campo",
);
assert.equal(
  isSemanticallyCompatibleField({
    pendingOperation: "meter_horometro",
    activeExpectation: "km",
    structuredField: "meter_value",
    incomingActionRisk: null,
  }),
  true,
);

assert.throws(() =>
  assertOperationAuthorityInvariants({
    pendingOperation: "meter_horometro",
    pendingStage: "collecting",
    activeExpectation: "km",
    incomingActionRisk: "read",
    incomingMatchesExpectedField: true,
    hasPendingClarification: false,
    pendingClarificationChoice: null,
    incomingStructuredClarification: false,
  }),
);

assert.throws(() =>
  assertOperationAuthorityInvariants({
    pendingOperation: "mantenimiento",
    pendingStage: "collecting",
    activeExpectation: "detail",
    incomingActionRisk: "write",
    incomingMatchesExpectedField: true,
    hasPendingClarification: false,
    pendingClarificationChoice: null,
    incomingStructuredClarification: false,
  }),
);

assert.throws(() =>
  assertOperationAuthorityInvariants({
    pendingOperation: "meter_horometro",
    pendingStage: "collecting",
    activeExpectation: "clarification",
    incomingActionRisk: null,
    incomingMatchesExpectedField: true,
    hasPendingClarification: true,
    pendingClarificationChoice: "status",
    incomingStructuredClarification: false,
  }),
);

console.log("=== buildOperationAuthority fuerza invariantes ===");
{
  const authRead = buildOperationAuthority({
    pendingAction: {
      type: "certificados",
      createdAt: new Date().toISOString(),
      payload: { stage: "awaiting_unit", turnLayer: { activeExpectation: "unit" } },
    },
    incomingActionRisk: "read",
    structuredField: "unit_ref",
  });
  assert.equal(authRead.incomingMatchesExpectedField, false);
  assert.equal(authRead.incomingActionRisk, "read");
}

function pendingMeter(kind, expectation = "km") {
  return {
    type: "odometro",
    createdAt: new Date().toISOString(),
    payload: {
      stage: "collecting",
      meterType: kind,
      patente: "AG228NZ",
      turnLayer: { activeExpectation: expectation },
    },
  };
}

function pendingCert(expectation = "unit") {
  return {
    type: "certificados",
    createdAt: new Date().toISOString(),
    payload: {
      stage: expectation === "confirmo" ? "confirmation_required" : "awaiting_unit",
      plate: "AG228NZ",
      turnLayer: { activeExpectation: expectation },
    },
  };
}

function pendingMaint(expectation = "unit") {
  return {
    type: "mantenimiento",
    createdAt: new Date().toISOString(),
    payload: {
      stage: "collecting",
      patente: "AG228NZ",
      turnLayer: { activeExpectation: expectation },
    },
  };
}

function pendingWithClarification(pendingBase, unitRef = "900121") {
  const p = structuredClone(pendingBase);
  const prevExp =
    p.payload?.turnLayer?.activeExpectation ||
    (pendingBase.type === "certificados" ? "unit" : "km");
  p.payload = {
    ...p.payload,
    turnLayer: {
      activeExpectation: "clarification",
      pausedExpectation: prevExp,
      forkPending: false,
      lateralPause: true,
      pendingClarification: {
        kind: "unit_ref_action",
        purpose: "choose_status_or_continue",
        unitRef: { kind: "unit_name", value: unitRef },
      },
    },
  };
  return p;
}

console.log("=== Casos obligatorios 1–7 ===");
/** @type {Array<{name: string, pending: object|null, text: string, decision: string, match?: boolean, risk?: string|null, choice?: string|null, hasClarif?: boolean}>} */
const mandatory = [
  {
    name: "1. Cert unit + Estado 900100 → overlay",
    pending: pendingCert("unit"),
    text: "Estado 900100",
    decision: "overlay_read_keep_pending",
    match: false,
    risk: "read",
  },
  {
    name: "2. Maint unit + Estado 900100 → overlay",
    pending: pendingMaint("unit"),
    text: "Estado 900100",
    decision: "overlay_read_keep_pending",
    match: false,
    risk: "read",
  },
  {
    name: "3. Horo valor + Estado 900100 → overlay (no valor)",
    pending: pendingMeter("horometro", "km"),
    text: "Estado 900100",
    decision: "overlay_read_keep_pending",
    match: false,
    risk: "read",
  },
  {
    name: "4. Maint detail + certificado explícito → fork",
    pending: pendingMaint("detail"),
    text: "necesito un certificado de cobertura",
    decision: "fork_incompatible_write",
    match: false,
    risk: "write",
  },
  {
    name: "5. Maint detail + nuevo mantenimiento explícito → fork (nunca detail)",
    pending: pendingMaint("detail"),
    text: "quiero hacer un mantenimiento preventivo",
    decision: "fork_incompatible_write",
    match: false,
    risk: "write",
  },
  {
    name: "6. Cert unit + 900100 solo → continue cert",
    pending: pendingCert("unit"),
    text: "900100",
    decision: "continue_expected_field",
    match: true,
    risk: null,
  },
  {
    name: "7. Horo horas + 77 → continue horo",
    pending: pendingMeter("horometro", "km"),
    text: "77",
    decision: "continue_expected_field",
    match: true,
    risk: null,
  },
];

for (const c of mandatory) {
  const r = classifyOperationPrecedence({
    pendingAction: c.pending,
    selectionText: c.text,
    threadText: "",
  });
  assertOperationAuthorityInvariants(r.authority);
  assert.equal(r.decision, c.decision, `${c.name}: decision=${r.decision}`);
  if (c.match !== undefined) {
    assert.equal(r.authority.incomingMatchesExpectedField, c.match, `${c.name}: match`);
  }
  if (c.risk !== undefined) {
    assert.equal(r.authority.incomingActionRisk, c.risk, `${c.name}: risk`);
  }
}

console.log("=== Casos obligatorios clarificación XOR ===");
/** @type {Array<{name: string, pending: object|null, text: string, decision: string, choice?: string|null, hasClarif?: boolean, openClarif?: boolean}>} */
const clarifCases = [
  {
    name: "C1. pending clarif horo + GPS → resolve (status)",
    pending: pendingWithClarification(pendingMeter("horometro", "km")),
    text: "GPS",
    decision: "resolve_pending_clarification",
    choice: "status",
    hasClarif: true,
  },
  {
    name: "C2. pending clarif horo + estado → resolve (status)",
    pending: pendingWithClarification(pendingMeter("horometro", "km")),
    text: "estado",
    decision: "resolve_pending_clarification",
    choice: "status",
    hasClarif: true,
  },
  {
    name: "C3. pending clarif + es para el trámite → resolve (continue)",
    pending: pendingWithClarification(pendingMeter("horometro", "km")),
    text: "es para el trámite",
    decision: "resolve_pending_clarification",
    choice: "continue",
    hasClarif: true,
  },
  {
    name: "C4. pending clarif + ambigua → resolve (ambiguous)",
    pending: pendingWithClarification(pendingMeter("horometro", "km")),
    text: "tal vez",
    decision: "resolve_pending_clarification",
    choice: "ambiguous",
    hasClarif: true,
  },
  {
    name: "C5. sin pending clarif + Estado 900121 → overlay normal",
    pending: pendingMeter("horometro", "km"),
    text: "Estado 900121",
    decision: "overlay_read_keep_pending",
    hasClarif: false,
    choice: null,
  },
  {
    name: "C6. pending clarif certificado + GPS → resolve (misma política)",
    pending: pendingWithClarification(pendingCert("unit"), "900121"),
    text: "GPS",
    decision: "resolve_pending_clarification",
    choice: "status",
    hasClarif: true,
  },
  {
    name: "C7. pending clarif mantenimiento + GPS → resolve (misma política)",
    pending: pendingWithClarification(pendingMaint("unit"), "900121"),
    text: "GPS",
    decision: "resolve_pending_clarification",
    choice: "status",
    hasClarif: true,
  },
  {
    name: "C8. pending clarif odo + GPS → resolve (misma política medidor)",
    pending: pendingWithClarification(pendingMeter("odometro", "km"), "900121"),
    text: "GPS",
    decision: "resolve_pending_clarification",
    choice: "status",
    hasClarif: true,
  },
  {
    name: "C9. XOR clarif gana aunque el texto diga Estado (no overlay directo)",
    pending: pendingWithClarification(pendingMeter("horometro", "km")),
    text: "Estado 900121",
    decision: "resolve_pending_clarification",
    choice: "status",
    hasClarif: true,
    openClarif: false,
  },
];

for (const c of clarifCases) {
  const r = classifyOperationPrecedence({
    pendingAction: c.pending,
    selectionText: c.text,
    threadText: "",
  });
  assertOperationAuthorityInvariants(r.authority);
  assert.equal(r.decision, c.decision, `${c.name}: decision=${r.decision}`);
  if (c.hasClarif !== undefined) {
    assert.equal(r.authority.hasPendingClarification, c.hasClarif, `${c.name}: hasClarif`);
  }
  if (c.choice !== undefined) {
    assert.equal(r.authority.pendingClarificationChoice, c.choice, `${c.name}: choice`);
  }
  if (c.openClarif !== undefined) {
    assert.equal(
      r.authority.incomingStructuredClarification,
      c.openClarif,
      `${c.name}: openClarif`,
    );
  }
}

console.log("=== casos mínimos adicionales ===");
/** @type {Array<{name: string, pending: object|null, text: string, decision: string, op?: string|null}>} */
const cases = [
  {
    name: "odo km + número → continue odo",
    pending: pendingMeter("odometro", "km"),
    text: "128900",
    decision: "continue_expected_field",
    op: "meter_odometro",
  },
  {
    name: "cualquiera fecha_hora + fecha → continue",
    pending: pendingMeter("horometro", "fecha_hora"),
    text: "hoy a las 14:30",
    decision: "continue_expected_field",
    op: "meter_horometro",
  },
  {
    name: "maint unit + patente → continue maint",
    pending: pendingMaint("unit"),
    text: "AG 228 NZ",
    decision: "continue_expected_field",
    op: "mantenimiento",
  },
  {
    name: "maint detail + dato válido → continue",
    pending: pendingMaint("detail"),
    text: "cambio de aceite y filtros",
    decision: "continue_expected_field",
    op: "mantenimiento",
  },
  {
    name: "número suelto sin pending → normal",
    pending: null,
    text: "77",
    decision: "normal_route",
    op: null,
  },
  {
    name: "número sin expectation estructurada → no asumir medidor",
    pending: {
      type: "odometro",
      createdAt: new Date().toISOString(),
      payload: {},
    },
    text: "77",
    decision: "normal_route",
  },
];

for (const c of cases) {
  const r = classifyOperationPrecedence({
    pendingAction: c.pending,
    selectionText: c.text,
    threadText: "",
  });
  assertOperationAuthorityInvariants(r.authority);
  assert.equal(r.decision, c.decision, `${c.name}: decision`);
  if (c.op !== undefined) {
    assert.equal(r.authority.pendingOperation, c.op, `${c.name}: op`);
  }
}

console.log("=== historial viejo no entra en authority ===");
const withStaleThread = classifyOperationPrecedence({
  pendingAction: pendingMeter("horometro", "km"),
  selectionText: "77",
  threadText: [
    "📋 *Confirmar certificado*",
    "Respondé CONFIRMO o CANCELAR",
    "¿Cuál unidad? Pasame la matrícula completa",
  ].join("\n"),
});
assert.equal(withStaleThread.decision, "continue_expected_field");
assert.equal(withStaleThread.authority.pendingOperation, "meter_horometro");

console.log("=== adapters write-only ===");
for (const id of ["meter_odometro", "meter_horometro", "certificados", "mantenimiento"]) {
  assert.ok(OPERATION_MODULE_ADAPTERS[id], id);
  assert.equal(OPERATION_MODULE_ADAPTERS[id].risk, "write");
}

assert.equal(classifyStructuredIncomingField("77"), "meter_value");

console.log("OK verify-operation-precedence-matrix");
