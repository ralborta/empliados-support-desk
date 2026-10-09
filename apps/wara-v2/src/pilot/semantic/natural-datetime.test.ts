/**
 * Fechas naturales + correct_fields + valor anómalo.
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
} from "../operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
} from "../conversation-state.js";
import { setOdometerWriteDepsForTests } from "../odometer-turn.js";
import { applySemanticPolicy } from "./policy-engine.js";
import {
  diagnoseSaturdayBugExample,
  resolveNaturalReadingDatetime,
  reconcileLlmReadingFields,
  softTimeQuestionForMessage,
  FECHA_LECTURA_QUESTION,
} from "./natural-datetime.js";
import { detectOdometerFieldCorrection } from "./field-correction.js";
import { isAnomalousReading } from "./reading-anomaly.js";
import type { TurnDecision } from "./turn-decision-schema.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const PHONE = "+5491100000DATE";
const TENANT = "tenant_date_fix";
const TZ = "America/Argentina/Buenos_Aires";
const LOCAL_NOW = "2026-08-12T15:00:00";

const UNITS: WaraUnidadEstado[] = [
  {
    movil_id: 140,
    unidad: "M900-140",
    patente: "AD307VS",
    odometro: 120000,
    horometro: 4500,
    ultimo_reporte: { hace_segundos: 90 },
  },
];

let msgSeq = 0;
let odoWrites = 0;
let tempDir = "";

function seedOdoAwaitFecha(opts?: { fecha?: string; value?: number }) {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.selectedUnit = {
    movil_id: 140,
    patente: "AD307VS",
    unidad: "M900-140",
    label: "AD 307 VS (M900-140)",
  };
  st.fleetCache = UNITS;
  st.fleetCacheAt = new Date().toISOString();
  st.activeTramite = "odometer_update";
  st.odometerDraft = {
    meterType: "odometro",
    unit: st.selectedUnit,
    valueNew: opts?.value ?? 121000,
    valuePrevious: 120000,
    anomalyCandidate: null,
    fechaLecturaIso: opts?.fecha ? `${opts.fecha}T18:15:00` : null,
    fechaDisplay: opts?.fecha ? `${opts.fecha.slice(8, 10)}/${opts.fecha.slice(5, 7)}/${opts.fecha.slice(0, 4)} 18:15` : null,
    fechaDatePart: opts?.fecha ?? null,
    fechaTimePart: opts?.fecha ? "18:15:00" : null,
    step: opts?.fecha ? "await_confirm" : "await_fecha",
  };
  if (opts?.fecha) {
    const q =
      `Voy a registrar en WARA:\n` +
      `• ${st.selectedUnit.label}\n` +
      `• Odómetro: ${opts.value ?? 121000} km\n` +
      `• Anterior: 120000 km\n` +
      `• Fecha: ${st.odometerDraft.fechaDisplay}\n` +
      `Si está correcto, respondé CONFIRMO.`;
    st.pendingConfirmation = {
      action: "odometer_write",
      unit: st.selectedUnit,
      askedAt: new Date().toISOString(),
      question: q,
    };
    st.lastAgentQuestion = q;
  } else {
    st.lastAgentQuestion = FECHA_LECTURA_QUESTION;
  }
  savePilotConversationState(st);
  return st;
}

async function turn(text: string) {
  return resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `dt-${++msgSeq}`,
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      WARA_V2_ODOMETER_WRITE_ENABLED: "false",
      ALLOW_EXTERNAL_MUTATIONS: "false",
    },
  });
}

function msgOf(r: Awaited<ReturnType<typeof turn>>): string {
  return r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
}

describe("natural datetime + field correction + anomaly", () => {
  beforeEach(() => {
    msgSeq = 0;
    odoWrites = 0;
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-date-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: UNITS }),
    });
    setOdometerWriteDepsForTests({
      registerReading: async () => {
        odoWrites += 1;
        return { ok: true, summary: "DRY", payload: {} };
      },
    });
  });

  afterEach(() => {
    setPilotOperationalDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("diagnóstico: 06/08 vino del ejemplo de la pregunta + LLM", () => {
    const d = diagnoseSaturdayBugExample(LOCAL_NOW);
    assert.equal(d.llmFields.date, "2026-08-06");
    assert.equal(d.resolvedDate, "2026-08-08");
    assert.equal(d.resolvedWeekday, "sábado");
    assert.equal(d.policyFields.date, "2026-08-08");
    assert.match(d.cause ?? "", /ejemplo|06\/08/i);
  });

  it("tabla localNow=2026-08-12", () => {
    const cases: Array<[string, string, string | null]> = [
      ["el sábado 18:15", "2026-08-08", "18:15"],
      ["el domingo 11:30", "2026-08-09", "11:30"],
      ["el lunes", "2026-08-10", null],
      ["ayer tipo 6", "2026-08-11", "18:00"],
      ["hoy", "2026-08-12", null],
      ["sábado", "2026-08-08", null],
    ];
    for (const [msg, date, time] of cases) {
      const r = resolveNaturalReadingDatetime(msg, { timezone: TZ, localNow: LOCAL_NOW });
      assert.equal(r.kind, "resolved", msg);
      if (r.kind === "resolved") {
        assert.equal(r.date, date, msg);
        assert.equal(r.time, time, msg);
      }
    }
    const prox = resolveNaturalReadingDatetime("el próximo sábado", {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.equal(prox.kind, "future_explicit");
  });

  it("policy recalcula sábado cuando LLM copia 06/08", () => {
    const st = seedOdoAwaitFecha();
    const decision: TurnDecision = {
      action: "provide_fields",
      intent: "odometer",
      confidence: 0.9,
      currentTramiteDisposition: "keep",
      reasoningCode: "PROVIDED_MISSING_FIELD",
      fields: { date: "2026-08-06", time: "18:15", timezone: TZ },
    };
    const r = applySemanticPolicy(decision, st, {
      timezone: TZ,
      message: "el sábado 18:15",
      localNow: LOCAL_NOW,
    });
    assert.equal(r.ok, true);
    assert.equal(r.decision.fields?.date, "2026-08-08");
    assert.equal(r.decision.fields?.time, "18:15");
  });

  it("próximo sábado pide confirmación (no llega al resumen)", () => {
    const st = seedOdoAwaitFecha();
    const decision: TurnDecision = {
      action: "provide_fields",
      intent: "odometer",
      confidence: 0.9,
      currentTramiteDisposition: "keep",
      reasoningCode: "PROVIDED_MISSING_FIELD",
      fields: { date: "2026-08-15", time: "10:00", timezone: TZ },
    };
    const r = applySemanticPolicy(decision, st, {
      timezone: TZ,
      message: "el próximo sábado 10:00",
      localNow: LOCAL_NOW,
    });
    assert.equal(r.ok, false);
    assert.match(r.decision.ambiguity?.question ?? "", /futur|pasad|próximo|proximo/i);
  });

  it("el sábado 18:15 → resumen 08/08/2026 18:15 sin escribir", async () => {
    seedOdoAwaitFecha();
    // Simular decisión ya policy-reconciled vía atajo: provide_fields con mensaje real
    // (el cerebro unificado + policy). Forzamos el camino execute con policy.
    const st = getPilotConversationState(TENANT, PHONE)!;
    const decision: TurnDecision = {
      action: "provide_fields",
      intent: "odometer",
      confidence: 0.9,
      currentTramiteDisposition: "keep",
      reasoningCode: "PROVIDED_MISSING_FIELD",
      fields: { date: "2026-08-06", time: "18:15" },
    };
    const policy = applySemanticPolicy(decision, st, {
      timezone: TZ,
      message: "el sábado 18:15",
      localNow: LOCAL_NOW,
    });
    const { executeTurnDecision } = await import("./execute-decision.js");
    const exec = await executeTurnDecision(policy.decision, st, {
      messageId: "x1",
      env: process.env,
      fleetUnits: UNITS,
      originalMessage: "el sábado 18:15",
      showListing: () => undefined,
      askGpsConfirmation: () => "",
      deliverGpsReport: () => "",
      handleGpsSideQuery: async ({ state }) => ({ message: "", state }),
    });
    assert.match(exec.message, /08\/08\/2026 18:15/);
    assert.doesNotMatch(exec.message, /06\/08\/2026/);
    assert.equal(odoWrites, 0);
  });

  it("la fecha está mal → correct_fields, no cancela", () => {
    const st = seedOdoAwaitFecha({ fecha: "2026-08-06" });
    const d = detectOdometerFieldCorrection("la fecha está mal", st, {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.ok(d);
    assert.equal(d!.action, "correct_fields");
    assert.deepEqual(d!.fieldsToClear, ["date"]);
    assert.equal(d!.currentTramiteDisposition, "keep");
  });

  it("la fecha no es del sábado → limpia date, no propone sábado", () => {
    const st = seedOdoAwaitFecha({ fecha: "2026-08-06" });
    const d = detectOdometerFieldCorrection("la fecha no es del sábado", st, {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.ok(d);
    assert.equal(d!.action, "correct_fields");
    assert.deepEqual(d!.fieldsToClear, ["date"]);
    assert.equal(d!.fields?.date, null);
  });

  it("no era el sábado, era el domingo → reemplaza por domingo", () => {
    const st = seedOdoAwaitFecha({ fecha: "2026-08-06" });
    const d = detectOdometerFieldCorrection("no era el sábado, era el domingo", st, {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.ok(d);
    assert.equal(d!.fields?.date, "2026-08-09");
  });

  it("no fue el sábado / era el domingo corrige resumen", async () => {
    seedOdoAwaitFecha({ fecha: "2026-08-06", value: 121000 });
    const msg1 = msgOf(await turn("la fecha está mal"));
    assert.match(msg1, /fecha|Mantengo|corrij/i);
    assert.doesNotMatch(msg1, /cancelar el trámite/i);
    const after = getPilotConversationState(TENANT, PHONE);
    assert.equal(after?.odometerDraft?.valueNew, 121000);
    assert.ok(after?.odometerDraft?.unit);
    assert.equal(after?.activeTramite, "odometer_update");

    const msg2 = msgOf(await turn("era el domingo"));
    assert.match(msg2, /09\/08\/2026|Corregí la fecha|CONFIRMO/i);
    assert.match(msg2, /Ahora:\s*09\/08\/2026|Fecha:\s*09\/08\/2026/i);
    assert.doesNotMatch(msg2, /Ahora:\s*06\/08\/2026|Fecha:\s*06\/08\/2026/i);
    assert.equal(odoWrites, 0);
  });

  it("era 18:30 corrige solo hora", async () => {
    seedOdoAwaitFecha({ fecha: "2026-08-08", value: 121000 });
    const msg = msgOf(await turn("era 18:30"));
    assert.match(msg, /18:30|Corregí|CONFIRMO/i);
    const st = getPilotConversationState(TENANT, PHONE);
    assert.equal(st?.odometerDraft?.valueNew, 121000);
    assert.equal(odoWrites, 0);
  });

  it("valor anómalo pide confirmación reforzada", async () => {
    const st = seedOdoAwaitFecha();
    st.odometerDraft!.step = "await_value";
    st.odometerDraft!.valueNew = null;
    st.odometerDraft!.fechaDatePart = null;
    st.odometerDraft!.fechaTimePart = null;
    st.odometerDraft!.fechaLecturaIso = null;
    st.pendingConfirmation = null;
    savePilotConversationState(st);
    assert.equal(
      isAnomalousReading({
        valueNew: 2_563_333,
        valuePrevious: 120_000,
        meterType: "odometro",
      }),
      true,
    );
    const { executeTurnDecision } = await import("./execute-decision.js");
    const exec = await executeTurnDecision(
      {
        action: "provide_fields",
        intent: "odometer",
        confidence: 1,
        currentTramiteDisposition: "keep",
        reasoningCode: "PROVIDED_MISSING_FIELD",
        fields: { numericValue: 2_563_333 },
      },
      st,
      {
        messageId: "anom1",
        env: process.env,
        fleetUnits: UNITS,
        originalMessage: "2563333",
        showListing: () => undefined,
        askGpsConfirmation: () => "",
        deliverGpsReport: () => "",
        handleGpsSideQuery: async ({ state }) => ({ message: "", state }),
      },
    );
    assert.match(exec.message, /muy superior|digitaci[oó]n/i);
    assert.equal(st.odometerDraft?.step, "await_anomaly_confirm");
    assert.equal(st.odometerDraft?.anomalyCandidate, 2563333);
    assert.equal(odoWrites, 0);
  });

  it("pregunta de fecha no incluye dd/mm/aaaa de ejemplo", () => {
    assert.doesNotMatch(FECHA_LECTURA_QUESTION, /\d{2}\/\d{2}\/\d{4}/);
    assert.match(FECHA_LECTURA_QUESTION, /sábado a las 18:15|ayer a las 8/i);
  });

  it("reconcileLlmReadingFields documenta override", () => {
    const r = reconcileLlmReadingFields({
      message: "el sábado 18:15",
      timezone: TZ,
      localNow: LOCAL_NOW,
      llmDate: "2026-08-06",
      llmTime: "18:15",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.date, "2026-08-08");
      assert.equal(r.overridden, true);
    }
  });

  it("fue a la tardecita pide precisión amable", () => {
    const r = resolveNaturalReadingDatetime("fue a la tardecita", {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.equal(r.kind, "needs_precision");
    if (r.kind === "needs_precision") {
      assert.match(r.question, /tarde.*hora/i);
    }
    assert.match(
      softTimeQuestionForMessage("fue a la tardecita") ?? "",
      /Entiendo que fue por la tarde/,
    );
  });

  it("tipo seis y media → 18:30", () => {
    const r = resolveNaturalReadingDatetime("tipo seis y media", {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.equal(r.kind, "resolved");
    if (r.kind === "resolved") {
      assert.equal(r.time, "18:30");
    }
  });

  it("anoche sin hora → needs_precision con fecha de ayer", () => {
    const r = resolveNaturalReadingDatetime("anoche", {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.equal(r.kind, "needs_precision");
    if (r.kind === "needs_precision") {
      assert.equal(r.date, "2026-08-11");
      assert.match(r.question, /noche|hora/i);
    }
  });

  it("a eso de las ocho → 20:00", () => {
    const r = resolveNaturalReadingDatetime("a eso de las ocho", {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.equal(r.kind, "resolved");
    if (r.kind === "resolved") {
      assert.equal(r.time, "20:00");
    }
  });

  it("el domingo a la tardecita → fecha + pregunta de hora", () => {
    const r = resolveNaturalReadingDatetime("el domingo a la tardecita", {
      timezone: TZ,
      localNow: LOCAL_NOW,
    });
    assert.equal(r.kind, "needs_precision");
    if (r.kind === "needs_precision") {
      assert.equal(r.date, "2026-08-09");
      assert.match(r.question, /tarde/i);
    }
  });

  it("esta mañana 5 → hoy 05:00 (no día 5 del mes)", () => {
    const r = resolveNaturalReadingDatetime("esta mañana 5", {
      localNow: "2026-08-13T08:30:00",
      timezone: TZ,
    });
    assert.equal(r.kind, "resolved");
    if (r.kind === "resolved") {
      assert.equal(r.date, "2026-08-13");
      assert.equal(r.time, "05:00");
      assert.equal(r.source, "relative");
    }
  });

  it("esta mañana a las 5 → hoy 05:00", () => {
    const r = resolveNaturalReadingDatetime("esta mañana a las 5", {
      localNow: "2026-08-13T08:30:00",
      timezone: TZ,
    });
    assert.equal(r.kind, "resolved");
    if (r.kind === "resolved") {
      assert.equal(r.date, "2026-08-13");
      assert.equal(r.time, "05:00");
    }
  });

  it("mo hoy / no hoy resuelven a hoy", () => {
    for (const m of ["mo hoy", "no hoy", "hoy"]) {
      const r = resolveNaturalReadingDatetime(m, {
        localNow: "2026-08-13T08:30:00",
        timezone: TZ,
      });
      assert.equal(r.kind, "resolved", m);
      if (r.kind === "resolved") assert.equal(r.date, "2026-08-13", m);
    }
  });

  it("horas coloquiales rioplatenses (paridad V1 odometroFecha)", () => {
    const localNow = "2026-08-17T10:00:00";
    const cases: Array<[string, string | null, string | null]> = [
      ["4 de la tarde", "2026-08-17", "16:00"],
      ["cuatro de la tarde", "2026-08-17", "16:00"],
      ["12 en punto", "2026-08-17", "12:00"],
      ["a las 8 de la mañana", "2026-08-17", "08:00"],
      ["tipo seis", "2026-08-17", "18:00"],
      ["ayer a las 4 de la tarde", "2026-08-16", "16:00"],
      ["Ayer 11:00", "2026-08-16", "11:00"],
    ];
    for (const [msg, date, time] of cases) {
      const r = resolveNaturalReadingDatetime(msg, { localNow, timezone: TZ });
      assert.equal(r.kind, "resolved", msg);
      if (r.kind === "resolved") {
        assert.equal(r.date, date, msg);
        assert.equal(r.time, time, msg);
      }
    }
  });
});
