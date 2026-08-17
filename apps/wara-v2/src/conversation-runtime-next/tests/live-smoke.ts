/**
 * Smoke multi-turno con LLM real.
 * Ejecutar: OPENAI_API_KEY=... pnpm exec tsx src/conversation-runtime-next/tests/live-smoke.ts
 */
import { processConversationTurn } from "../process-turn.js";
import { resetConversationStateV3 } from "../../commander-v3/persistence/store.js";
import { initCommanderV3PersistenceFromEnv } from "../../commander-v3/index.js";

initCommanderV3PersistenceFromEnv(process.env);

const tenant = "tenant_smoke";
const phone = "+5491199000001";

async function main() {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 20) {
    console.log("BLOCKED: OPENAI_API_KEY no disponible");
    process.exit(0);
  }

  resetConversationStateV3(tenant, phone);

  const env = {
    ...process.env,
    ALLOW_EXTERNAL_MUTATIONS: "false",
    WARA_V2_PILOT_OPEN: "true",
  };

  const turns = [
    { message: "Hola", id: "smoke-1" },
    { message: "¿Dónde está la unidad?", id: "smoke-2" },
    { message: "Hola", id: "smoke-3" },
  ];

  for (const t of turns) {
    const r = await processConversationTurn({
      tenantId: tenant,
      phone,
      message: t.message,
      messageId: t.id,
      env,
      contacts: [{ id: 1, nombre: "Smoke Co", empresa: "Smoke Co" }],
      fleetUnits: [],
    });
    console.log(`\n[${t.id}] user: ${t.message}`);
    console.log(`reply: ${r.reply.slice(0, 200)}`);
    console.log(`activeTask: ${r.state.activeTask?.type ?? "none"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
