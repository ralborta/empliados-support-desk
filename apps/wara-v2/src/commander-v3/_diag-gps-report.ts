/**
 * Diag live: reporte GPS por patente/marca (casos del screenshot).
 * Uso: set -a && source ../../.env.local && set +a && \
 *   WARA_CONVERSATION_COMMANDER_V3_LIVE=true pnpm exec tsx src/commander-v3/_diag-gps-report.ts
 */
import { runCommanderTurn } from "./run-turn.js";
import { resetConversationStateV3 } from "./persistence/store.js";
import { COMMANDER_V3_PROMPT_VERSION } from "./flags.js";

const PHONE = "+5491199990001";
const TENANT = "t_gps_diag";

const FLEET = [
  {
    movil_id: 7,
    unidad: "NISSAN 2404",
    patente: "AG562SP",
    odometro: 50000,
    horometro: 1200,
    ultimo_reporte: { hace_segundos: 45 },
    ultima_posicion: { hace_segundos: 50, lat: -34.6, lon: -58.4 },
    ultima_ignicion: { hace_segundos: 50, estado: false },
  },
  {
    movil_id: 8,
    unidad: "FORD 1",
    patente: "AA111AA",
    odometro: 1000,
    horometro: 10,
    ultimo_reporte: { hace_segundos: 120 },
  },
] as const;

const FLEET_CACHE = FLEET.map((u) => ({
  movilId: u.movil_id,
  plate: u.patente,
  name: u.unidad,
  label: `${u.patente.replace(/(.{2})(.{3})(.{2})/, "$1 $2 $3")} (${u.unidad})`,
}));

function reset(extra: Record<string, unknown> = {}) {
  resetConversationStateV3(TENANT, PHONE, "hard", {
    availableCompanies: [{ id: "1", name: "WARA", contactId: 1 }],
    company: { id: "1", name: "WARA", contactId: 1 },
    fleetCache: FLEET_CACHE,
    ...extra,
  });
}

async function turn(message: string, id: string) {
  const r = await runCommanderTurn({
    tenantId: TENANT,
    phone: PHONE,
    message,
    messageId: id,
    env: process.env,
    contacts: [{ id: 1, nombre: "R", empresa: "WARA" }],
    fleetUnits: FLEET as never,
  });
  const caps = r.trace.capabilitiesRequested?.map((c) => c.name) ?? [];
  console.log("\n===", message);
  console.log("prompt", COMMANDER_V3_PROMPT_VERSION);
  console.log("task", r.trace.turnPlan?.task, "act", r.trace.turnPlan?.conversationalAct);
  console.log("unitRef", JSON.stringify(r.trace.turnPlan?.unitReference));
  console.log("caps", caps);
  console.log("entity", JSON.stringify(r.trace.entityResolution?.unit));
  console.log("reply:", r.reply.slice(0, 280));
  return r;
}

async function main() {
  console.log("OPENAI", Boolean(process.env.OPENAI_API_KEY));

  reset();
  await turn("Quiero saber el reporte de la ag", "d1");

  reset();
  await turn("Quiero saber el reporte de la nissan", "d2");

  reset();
  await turn("Me indicas el reporte de la unidad AG 562 SP", "d3");

  reset({
    unit: {
      movilId: 7,
      plate: "AG562SP",
      name: "NISSAN 2404",
      label: "AG 562 SP (NISSAN 2404)",
    },
  });
  await turn("Quiero saber el estado de reporte", "d4");

  reset();
  await turn("La NISSAN", "d5a");
  await turn("Quiero saber el estado de reporte", "d5b");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
