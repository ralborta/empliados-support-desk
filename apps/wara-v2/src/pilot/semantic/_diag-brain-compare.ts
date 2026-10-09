/**
 * Trace comparativo legacy vs cerebro unificado (mismos seeds, sin mutaciones).
 *
 *   set -a && source ../../.env.local && set +a
 *   pnpm exec tsx src/pilot/semantic/_diag-brain-compare.ts
 */
import { mkdtempSync, writeFileSync } from "node:fs";
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
import type { WaraUnidadEstado } from "../wara-types.js";

const PHONE = "+5491100000088";
const TENANT = "tenant_compare";
const CONTACTS = [{ id: 2, nombre: "Lab", empresa: "El Cacique" }];
const UNIT: WaraUnidadEstado = {
  movil_id: 137,
  unidad: "M900-137",
  patente: "AD307VS",
  odometro: 120000,
  horometro: 4500,
  ultimo_reporte: { hace_segundos: 90 },
};
const UNIT2: WaraUnidadEstado = {
  ...UNIT,
  movil_id: 138,
  patente: "AD356UQ",
  unidad: "M900-138",
};

let seq = 0;
const mid = (s: string) => `cmp-${s}-${++seq}`;

async function turn(text: string, brain: boolean) {
  const r = await resolveOperationalTurn({
    tenantId: TENANT,
    phone: PHONE,
    text,
    messageId: mid(brain ? "u" : "l"),
    env: {
      ...process.env,
      WARA_V2_UNIFIED_SEMANTIC_BRAIN: brain ? "true" : "false",
      WARA_OBTENER_EMPRESA_TOKEN: "x",
      WARA_API_BASE_URL: "http://mock",
      ALLOW_EXTERNAL_MUTATIONS: "false",
    },
    contacts: CONTACTS,
  });
  return r.kind === "reply" || r.kind === "duplicate" ? r.message : `[${r.kind}]`;
}

function seedGps() {
  const st = createEmptyPilotState({ tenantId: TENANT, phone: PHONE, contacts: CONTACTS });
  st.sessionToken = "tok";
  st.selectedContactId = 2;
  st.companyName = "El Cacique";
  st.selectedUnit = {
    movil_id: 137,
    patente: "AD307VS",
    unidad: "M900-137",
    label: "AD 307 VS",
  };
  st.fleetCache = [UNIT, UNIT2];
  st.fleetCacheAt = new Date().toISOString();
  st.activeTramite = "await_confirm";
  st.pendingConfirmation = {
    action: "gps_report",
    unit: st.selectedUnit,
    askedAt: new Date().toISOString(),
    question: "¿Querés el reporte GPS?",
  };
  st.lastAgentQuestion = st.pendingConfirmation.question;
  savePilotConversationState(st);
}

async function runCase(label: string, setup: () => void, text: string) {
  const out: Record<string, string> = { label, text };
  for (const brain of [false, true]) {
    resetStateStore();
    resetPilotConversationStatesForTests();
    configurePilotStatePersistence(join(tmpdir(), `cmp-${brain}-${Date.now()}.json`));
    setPilotOperationalDepsForTests({
      createToken: async () => ({ ok: true, sessionToken: "tok" }),
      consultarFleet: async () => ({ ok: true, unidades: [UNIT, UNIT2] }),
    });
    setup();
    const reply = await turn(text, brain);
    const st = getPilotConversationState(TENANT, PHONE);
    out[brain ? "unified" : "legacy"] = reply.slice(0, 200);
    out[brain ? "unified_pending" : "legacy_pending"] = st?.pendingConfirmation?.action ?? "none";
  }
  return out;
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("OPENAI_API_KEY required for unified branch");
    process.exit(1);
  }
  setOdometerWriteDepsForTests({
    registerReading: async () => ({ ok: true, summary: "dry", payload: {} }),
  });
  setCertificateWriteDepsForTests({
    issue: async () => ({ ok: true, summary: "dry", payload: {} }),
  });

  const rows = [];
  rows.push(
    await runCase("B_no_quiero_certificado", seedGps, "no quiero certificado"),
  );
  const temp = mkdtempSync(join(tmpdir(), "brain-cmp-"));
  const path = join(temp, "compare.json");
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  console.log(JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
  console.error("wrote", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
