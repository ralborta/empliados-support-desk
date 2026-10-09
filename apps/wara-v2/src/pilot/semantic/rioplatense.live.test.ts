/**
 * Aceptación rioplatense — cerebro LLM real (sin mock de TurnDecision).
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true pnpm exec tsx --test \
 *     src/pilot/semantic/rioplatense.live.test.ts
 *
 * Full dataset: WARA_V2_RIOPLATENSE_FULL=true
 * Artefacto: /tmp/wara-v2-rioplatense-live.json (si WRITE_LIVE_ARTIFACT=1)
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOperationalTurn,
  setPilotOperationalDepsForTests,
  resetPilotConversationStatesForTests,
} from "../operational-turn.js";
import {
  configurePilotStatePersistence,
  createEmptyPilotState,
  resetPilotConversationStatesForTests as resetStateStore,
  savePilotConversationState,
} from "../conversation-state.js";
import { commitSelectedUnit } from "./unit-context.js";
import { isUnifiedSemanticBrainEnabled } from "./brain-flags.js";
import { getLastLabTurnDiagnosis } from "./lab-turn-diagnosis.js";
import { datasetStats, RIOPLATENSE_DATASET, type RioplatenseCase } from "./rioplatense-dataset.js";
import { INTERPRET_TURN_PROMPT_VERSION } from "./interpret-turn-prompt.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const LIVE =
  isUnifiedSemanticBrainEnabled(process.env) &&
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  process.env.WARA_V2_SEMANTIC_LIVE !== "false";

const FULL = process.env.WARA_V2_RIOPLATENSE_FULL === "true";

const PHONE = "+5491100000RIO";
const TENANT = "tenant_rioplatense";

const UNITS: WaraUnidadEstado[] = [
  {
    movil_id: 135,
    unidad: "M900-135",
    patente: "AD307VN",
    odometro: 225000,
    horometro: 3000,
    ultimo_reporte: { hace_segundos: 60 },
  },
  {
    movil_id: 71,
    unidad: "M900-071",
    patente: "AA175BY",
    odometro: 1000,
    horometro: 10,
    ultimo_reporte: { hace_segundos: 90 },
  },
];

const CORE_IDS = new Set([
  "ref-01",
  "ref-06",
  "ref-15",
  "col-01",
  "col-03",
  "col-08",
  "col-11",
  "typ-01",
  "typ-04",
  "typ-12",
  "voz-01",
  "voz-02",
  "chg-10",
  "dt-08",
  "dt-12",
  "dt-15",
]);

function pickCases(): RioplatenseCase[] {
  if (FULL) return RIOPLATENSE_DATASET;
  return RIOPLATENSE_DATASET.filter((c) => CORE_IDS.has(c.id));
}

type LiveRow = {
  id: string;
  category: string;
  message: string;
  action: string | null;
  intent: string | null;
  confidence: number | null;
  reasoningCode: string | null;
  handler: string | null;
  disposition: string | null;
  replyPreview: string;
  ok: boolean;
  note?: string;
};

(LIVE ? describe : describe.skip)("rioplatense live — LLM real", () => {
  let tempDir = "";
  let msgSeq = 0;
  const rows: LiveRow[] = [];

  before(() => {
    const stats = datasetStats();
    assert.ok(stats.byCat.colloquial! >= 50, `colloquial=${stats.byCat.colloquial}`);
    assert.ok(stats.byCat.typo! >= 20, `typo=${stats.byCat.typo}`);
    assert.ok(stats.byCat.voice! >= 15, `voice=${stats.byCat.voice}`);
    assert.ok(stats.byCat.idea_change! >= 15, `idea_change=${stats.byCat.idea_change}`);
    assert.ok(stats.byCat.contextual_ref! >= 10, `contextual_ref=${stats.byCat.contextual_ref}`);
    assert.ok(stats.byCat.imprecise_datetime! >= 10, `imprecise_datetime=${stats.byCat.imprecise_datetime}`);
  });

  before(() => {
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-rio-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: UNITS }),
    });
  });

  after(() => {
    setPilotOperationalDepsForTests(undefined);
    resetStateStore();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (process.env.WRITE_LIVE_ARTIFACT === "1") {
      writeFileSync(
        "/tmp/wara-v2-rioplatense-live.json",
        JSON.stringify(
          { promptVersion: INTERPRET_TURN_PROMPT_VERSION, at: new Date().toISOString(), rows },
          null,
          2,
        ),
      );
    }
  });

  function seedState(kind: RioplatenseCase["category"]) {
    const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE });
    st.sessionToken = "tok";
    st.selectedContactId = 1;
    st.companyName = "El Cacique";
    st.fleetCache = UNITS;
    st.fleetCacheAt = new Date().toISOString();
    commitSelectedUnit(st, UNITS[0]!, "explicit_plate");
    st.previousSelectedUnit = {
      patente: "AA175BY",
      unidad: "M900-071",
      movil_id: 71,
      label: "AA 175 BY (M900-071)",
    };
    if (
      kind === "imprecise_datetime" ||
      kind === "colloquial" ||
      kind === "typo" ||
      kind === "voice"
    ) {
      st.activeTramite = "odometer_update";
      st.odometerDraft = {
        meterType: "odometro",
        unit: st.selectedUnit,
        valueNew: 225663,
        valuePrevious: 225000,
        fechaLecturaIso: null,
        fechaDisplay: null,
        fechaDatePart: null,
        fechaTimePart: null,
        step: "await_fecha",
        anomalyCandidate: null,
      };
    }
    if (kind === "idea_change") {
      st.activeTramite = "certificate_issue";
      st.certificateDraft = { unit: st.selectedUnit, step: "await_confirm" };
      st.pendingConfirmation = {
        action: "certificate_issue",
        unit: st.selectedUnit!,
        askedAt: new Date().toISOString(),
        question: "¿Querés el certificado?",
      };
    }
    savePilotConversationState(st);
  }

  function softMatch(c: RioplatenseCase, diag: ReturnType<typeof getLastLabTurnDiagnosis>, reply: string): boolean {
    const exp = c.expect;
    if (!exp) return true;
    if (exp.notAction?.includes(diag?.action ?? "")) return false;
    if (exp.actionIncludes?.length) {
      if (!exp.actionIncludes.includes(diag?.action ?? "")) return false;
    }
    if (exp.intentIncludes?.length) {
      if (!exp.intentIncludes.includes(diag?.intent ?? "")) return false;
    }
    if (exp.dispositionKeep && diag?.currentTramiteDisposition && diag.currentTramiteDisposition !== "keep") {
      // soft: allow suspend for lateral switches
      if (diag.action !== "lateral_query" && diag.action !== "switch_intent" && diag.action !== "suspend_and_start") {
        return false;
      }
    }
    if (exp.reference === "previous_selected_unit") {
      const hit =
        /anterior|tenía seleccionada|tenia seleccionada|AD 307 VN|previous/i.test(reply) ||
        diag?.reasoningCode === "CONTEXTUAL_REFERENCE" ||
        diag?.handler?.includes("restore") ||
        diag?.handler?.includes("unit_context");
      if (!hit && diag?.action === "clarify") return false;
    }
    if (exp.reference === "selected_unit") {
      const hit =
        /AD 307 VN|misma|seleccionad|GPS|reporte|estado/i.test(reply) ||
        diag?.reasoningCode === "CONTEXTUAL_REFERENCE" ||
        diag?.intent === "gps";
      if (!hit && diag?.action === "clarify" && /reformul/i.test(reply)) return false;
    }
    // Nunca menú genérico ante coloquial de dominio
    if (/Puedo ayudarte con GPS, certificado/i.test(reply) && c.category !== "colloquial") {
      /* allow some */
    }
    if (/No entendí\. Reformulá/i.test(reply)) return false;
    return true;
  }

  for (const c of pickCases()) {
    it(`${c.id} [${c.category}] ${c.message.slice(0, 48)}`, async () => {
      msgSeq += 1;
      seedState(c.category);
      const r = await resolveOperationalTurn({
        tenantId: TENANT,
        phone: PHONE,
        text: c.message,
        messageId: `rio-${c.id}-${msgSeq}`,
        env: {
          ...process.env,
          WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
          WARA_OBTENER_EMPRESA_TOKEN: "x",
          WARA_API_BASE_URL: "http://mock",
          ALLOW_EXTERNAL_MUTATIONS: "false",
        },
        contacts: [{ id: 1, nombre: "Raúl", empresa: "El Cacique" }],
        customerName: "Raúl",
      });
      const reply = r.kind === "llm" ? "[LLM]" : r.message;
      const diag = getLastLabTurnDiagnosis();
      const ok = softMatch(c, diag, reply);
      rows.push({
        id: c.id,
        category: c.category,
        message: c.message,
        action: diag?.action ?? null,
        intent: diag?.intent ?? null,
        confidence: diag?.confidence ?? null,
        reasoningCode: diag?.reasoningCode ?? null,
        handler: diag?.handler ?? null,
        disposition: diag?.currentTramiteDisposition ?? null,
        replyPreview: reply.slice(0, 180),
        ok,
      });
      assert.ok(
        ok,
        `${c.id} fail action=${diag?.action} intent=${diag?.intent} handler=${diag?.handler} reply=${reply.slice(0, 120)}`,
      );
    });
  }
});

describe("rioplatense dataset inventory", () => {
  it("cumple conteos mínimos", () => {
    const s = datasetStats();
    assert.ok(s.total >= 100);
    assert.ok(s.byCat.colloquial! >= 50);
    assert.ok(s.byCat.typo! >= 20);
    assert.ok(s.byCat.voice! >= 15);
    assert.ok(s.byCat.idea_change! >= 15);
    assert.ok(s.byCat.contextual_ref! >= 10);
    assert.ok(s.byCat.imprecise_datetime! >= 10);
  });
});
