/**
 * Smoke multi-turno con LLM real + trazas sanitizadas.
 * OPENAI_API_KEY=... pnpm exec tsx src/conversation-runtime-next/tests/live-smoke.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { processConversationTurn } from "../process-turn.js";
import { resetConversationStateV3 } from "../../commander-v3/persistence/store.js";
import { initCommanderV3PersistenceFromEnv } from "../../commander-v3/index.js";

initCommanderV3PersistenceFromEnv(process.env);

const tenant = "tenant_smoke";
const phone = "+5491199000001";

type TurnSpec = { id: string; message: string };

const scenarios: Array<{ name: string; turns: TurnSpec[] }> = [
  {
    name: "saludo_con_gps_abierto",
    turns: [
      { id: "s1", message: "¿Dónde está la unidad?" },
      { id: "s2", message: "Hola" },
    ],
  },
  {
    name: "cambio_explicito_odometro",
    turns: [
      { id: "c1", message: "ubicación de la unidad" },
      { id: "c2", message: "Dejá eso, mejor carguemos el kilometraje." },
    ],
  },
  {
    name: "pregunta_lateral",
    turns: [
      { id: "l1", message: "gps de la unidad" },
      { id: "l2", message: "¿cuál es mi empresa?" },
    ],
  },
];

function sanitize(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const o = { ...(obj as Record<string, unknown>) };
  delete o.phone;
  if (Array.isArray(o.recentTurns)) {
    o.recentTurns = (o.recentTurns as unknown[]).slice(-4);
  }
  return o;
}

async function main() {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 20) {
    console.log("BLOCKED: OPENAI_API_KEY no disponible en este entorno.");
    console.log("Procedimiento shadow: desplegar SHA candidato con RUNTIME_NEXT=false, luego smoke remoto.");
    process.exit(0);
  }

  const env = {
    ...process.env,
    ALLOW_EXTERNAL_MUTATIONS: "false",
    WARA_V2_PILOT_OPEN: "true",
  };

  const traces: unknown[] = [];

  for (const scenario of scenarios) {
    resetConversationStateV3(tenant, phone);
    console.log(`\n=== ${scenario.name} ===`);
    for (const t of scenario.turns) {
      const r = await processConversationTurn({
        tenantId: tenant,
        phone,
        message: t.message,
        messageId: t.id,
        env,
        contacts: [{ id: 1, nombre: "Smoke Co", empresa: "Smoke Co" }],
        fleetUnits: [],
      });
      console.log(`[${t.id}] user: ${t.message}`);
      console.log(`reply: ${r.reply.slice(0, 280)}`);
      traces.push({
        scenario: scenario.name,
        turnId: t.id,
        message: t.message,
        reply: r.reply.slice(0, 500),
        runtimeNext: r.trace.runtimeNext,
        activeTask: r.state.activeTask?.type,
        validationOk: r.trace.validation?.ok,
      });
    }
  }

  const out = join(process.cwd(), "src/conversation-runtime-next/tests/live-smoke-traces.json");
  writeFileSync(out, JSON.stringify(sanitize(traces), null, 2), "utf8");
  console.log(`\nTrazas guardadas: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
