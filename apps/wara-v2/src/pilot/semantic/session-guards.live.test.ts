/**
 * LIVE — empresa / cancelación / despedida / confirmación (LLM real, sin mock TurnDecision).
 *
 *   set -a && source ../../.env.local && set +a
 *   WARA_V2_UNIFIED_SEMANTIC_BRAIN=true WARA_V2_SEMANTIC_LIVE=true \
 *     pnpm exec tsx --test --test-concurrency=1 \
 *     src/pilot/semantic/session-guards.live.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
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
import { setCertificateWriteDepsForTests } from "../certificate-turn.js";
import { setMaintenanceWriteDepsForTests } from "../maintenance-turn.js";
import { setTicketWriteDepsForTests } from "../ticket-turn.js";
import { isUnifiedSemanticBrainEnabled } from "./brain-flags.js";
import { getLastLabTurnDiagnosis } from "./lab-turn-diagnosis.js";
import { commitSelectedUnit } from "./unit-context.js";
import type { WaraUnidadEstado } from "../wara-types.js";

const LIVE =
  isUnifiedSemanticBrainEnabled(process.env) &&
  Boolean(process.env.OPENAI_API_KEY?.trim()) &&
  process.env.WARA_V2_SEMANTIC_LIVE !== "false";

const TENANT = "tenant_sess_live";
const PHONE = "+5491100000SLIVE";
const CONTACTS = [
  { id: 1, nombre: "Raúl", empresa: "El Cacique" },
  { id: 2, nombre: "Raúl", empresa: "WARA Demo" },
];

const UNIT: WaraUnidadEstado = {
  movil_id: 501,
  unidad: "M900-501",
  patente: "AD307VQ",
  odometro: 120000,
  horometro: 4000,
  ultimo_reporte: { hace_segundos: 60 },
  ultima_posicion: { hace_segundos: 70 },
};

let tempDir = "";
let msgSeq = 0;
let writeCalls = 0;
const traces: Array<Record<string, unknown>> = [];

async function turn(text: string) {
  msgSeq += 1;
  const before = getPilotConversationState(TENANT, PHONE);
  const pendingBefore = before?.pendingConfirmation
    ? {
        action: before.pendingConfirmation.action,
        operationId: before.pendingConfirmation.operationId ?? null,
        version: before.pendingConfirmation.version ?? null,
      }
    : null;
  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: `slive-${msgSeq}`,
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: "true",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
      WARA_V2_ODOMETER_WRITE_ENABLED: "false",
      WARA_V2_CERTIFICATE_WRITE_ENABLED: "false",
      WARA_V2_ODOO_WRITE_ENABLED: "false",
      WARA_V2_DELIVERY_ENABLED: "false",
      WARA_V2_ROUTER_ENABLED: "false",
    },
    contacts: CONTACTS,
    customerName: "Raúl",
  });
  const msg = r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
  const after = getPilotConversationState(TENANT, PHONE);
  const diag = getLastLabTurnDiagnosis();
  const row = {
    message: text,
    lastAgentQuestionMeta: after?.lastAgentQuestionMeta ?? null,
    llmCalled: diag?.llm_called ?? null,
    turnDecision: diag
      ? {
          action: diag.action,
          intent: diag.intent,
          answer: diag.answer,
          disposition: diag.currentTramiteDisposition,
          reasoningCode: diag.reasoningCode,
          handler: diag.handler,
        }
      : null,
    precedenceResult: { handler: diag?.handler ?? null },
    pendingBefore,
    operationTransition: {
      pendingAfter: after?.pendingConfirmation?.action ?? null,
      activeTramite: after?.activeTramite ?? null,
    },
    toolInvoked: diag?.handler ?? "",
    writes: writeCalls,
    pendingAfter: after?.pendingConfirmation
      ? {
          action: after.pendingConfirmation.action,
          operationId: after.pendingConfirmation.operationId ?? null,
        }
      : null,
    reply: msg.slice(0, 400),
  };
  traces.push(row);
  return { msg, after, diag, row };
}

function seedActive() {
  const st = createEmptyPilotState({
    tenantId: TENANT,
    phone: PHONE,
    contacts: CONTACTS,
  });
  st.sessionToken = "tok";
  st.selectedContactId = 1;
  st.companyName = "El Cacique";
  st.fleetCache = [UNIT];
  st.fleetCacheAt = new Date().toISOString();
  commitSelectedUnit(st, UNIT, "explicit_plate");
  st.conversationMetadata = { greetedAt: new Date().toISOString(), introducedAtilio: true };
  savePilotConversationState(st);
  return st;
}

describe("LIVE sesión: empresa / cancel / farewell / confirm", { skip: !LIVE }, () => {
  beforeEach(() => {
    msgSeq = 0;
    writeCalls = 0;
    traces.length = 0;
    resetStateStore();
    resetPilotConversationStatesForTests();
    tempDir = mkdtempSync(join(tmpdir(), "wara-v2-slive-"));
    configurePilotStatePersistence(join(tempDir, "state.json"));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT] }),
    });
    setOdometerWriteDepsForTests({
      writeOdometer: async () => {
        writeCalls += 1;
        return { ok: true };
      },
    });
    setCertificateWriteDepsForTests({
      issueCertificate: async () => {
        writeCalls += 1;
        return { ok: true };
      },
    });
    setMaintenanceWriteDepsForTests({
      createMaintenance: async () => {
        writeCalls += 1;
        return { ok: true, dryRun: true };
      },
    });
    setTicketWriteDepsForTests({
      createTicket: async () => {
        writeCalls += 1;
        return { ok: true, ticketId: 1, ref: "T-LAB" };
      },
    });
  });

  afterEach(() => {
    const out = join(tempDir, "session-guards.live.traces.json");
    try {
      writeFileSync(out, JSON.stringify(traces, null, 2));
    } catch {
      /* ignore */
    }
    setPilotOperationalDepsForTests(undefined);
    setOdometerWriteDepsForTests(undefined);
    setCertificateWriteDepsForTests(undefined);
    setMaintenanceWriteDepsForTests(undefined);
    setTicketWriteDepsForTests(undefined);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("empresa activa — variantes naturales", async () => {
    seedActive();
    for (const phrase of [
      "en q empresa estoy",
      "qué empresa tengo elegida ahora?",
      "con cuál estoy trabajando?",
    ]) {
      const { msg, diag } = await turn(phrase);
      assert.match(msg, /El Cacique/i, phrase);
      assert.doesNotMatch(msg, /Una unidad es|móvil de la flota/i, phrase);
      // LLM o policy query_context — no domain unit.
      if (diag?.llm_called) {
        assert.notEqual(diag.intent, "domain_knowledge");
      }
    }
  });

  it("mantenimiento → no, mejor dejalo → cancela", async () => {
    seedActive();
    await turn("quiero agendar un mantenimiento");
    await turn("cambio de aceite urgente");
    const before = getPilotConversationState(TENANT, PHONE)!;
    assert.ok(before.pendingConfirmation || before.maintenanceDraft);
    const writesBefore = writeCalls;
    const { msg, after } = await turn("no, mejor dejalo");
    assert.match(msg, /cancel|Cancel|No se registró|no se registró/i);
    assert.equal(after?.pendingConfirmation, null);
    assert.equal(writeCalls, writesBefore);
  });

  it("mantenimiento → no está bien, lo cancelo", async () => {
    seedActive();
    await turn("quiero agendar un mantenimiento");
    await turn("revisar frenos");
    const writesBefore = writeCalls;
    const { msg, after } = await turn("no está bien, lo cancelo");
    assert.match(msg, /cancel|Cancel|No se registró|no se registró/i);
    assert.doesNotMatch(msg, /Voy a registrar|CONFIRMO/i);
    assert.equal(after?.pendingConfirmation, null);
    assert.equal(writeCalls, writesBefore);
  });

  it("mantenimiento → sí quiero cancelar", async () => {
    seedActive();
    await turn("quiero agendar un mantenimiento");
    await turn("service 10k");
    const { msg, after } = await turn("sí quiero cancelar");
    assert.match(msg, /cancel|Cancel|No se registró|no se registró/i);
    assert.equal(after?.pendingConfirmation, null);
    assert.equal(writeCalls, 0);
  });

  it("ticket → gracias chau → no crea", async () => {
    seedActive();
    await turn("quiero hablar con un operador");
    await turn("necesito ayuda con una unidad que no reporta bien");
    const mid = getPilotConversationState(TENANT, PHONE)!;
    assert.ok(
      mid.pendingConfirmation?.action === "odoo_ticket_create" || mid.ticketDraft,
      "debe haber ticket pending",
    );
    const writesBefore = writeCalls;
    const { msg, after } = await turn("gracias chau");
    assert.match(msg, /No generé el ticket|cuando quieras|Cancelé|cancel/i);
    assert.doesNotMatch(msg, /Ticket simulado OK|ticketId|T-LAB/i);
    assert.equal(after?.pendingConfirmation, null);
    assert.equal(writeCalls, writesBefore);
  });

  it("ticket → sí, confirmo → simula una vez (dry-run)", async () => {
    seedActive();
    await turn("quiero hablar con un operador");
    await turn("derivación por falla de GPS en AD307VQ");
    const mid = getPilotConversationState(TENANT, PHONE)!;
    assert.equal(mid.pendingConfirmation?.action, "odoo_ticket_create");
    const { msg, after } = await turn("sí, confirmo");
    // En lab dry-run: mensaje de simulación o confirmación — nunca escritura externa real.
    assert.match(msg, /simulado|ticket|deriv|Lab|OK|operador/i);
    assert.equal(after?.pendingConfirmation, null);
    // createTicket mock puede contarse; ALLOW_EXTERNAL_MUTATIONS=false en env.
    assert.ok(writeCalls <= 1);
  });
});

if (!LIVE) {
  describe("LIVE sesión (skip)", () => {
    it("skipped — falta OPENAI_API_KEY o flag unificado", () => {
      assert.ok(true);
    });
  });
}
