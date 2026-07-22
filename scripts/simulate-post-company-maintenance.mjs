#!/usr/bin/env node
/**
 * Simula el flujo post-empresa → mantenimiento SIN WhatsApp ni deploy a Vercel.
 *
 * Modo offline (default): lógica de routing/intents — no necesita DB ni servidor.
 * Modo live (--live): POST a tu Next local (npm run dev) con un número real registrado en Wara.
 *
 * Uso:
 *   npx tsx scripts/simulate-post-company-maintenance.mjs
 *   npx tsx scripts/simulate-post-company-maintenance.mjs --live --phone=549XXXXXXXXXX
 *
 * Variables (solo --live):
 *   PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY
 *   WARA_TURN_BASE_URL (default http://localhost:3000)
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  formatCompanyConfirmMessage,
  looksLikeMaintenanceCapabilityQuestion,
  looksLikeNonOdometerOperationalIntent,
  looksLikeOperationalMaintenanceIntent,
  shouldSkipStrayMaintenanceRequest,
} from "../src/lib/waraApi.ts";

const MAINT_TEXT = "Quiero programar un mantenimiento";
const THREAD_AFTER_COMPANY = [
  "Veo que este número está asociado a más de una empresa en Wara.",
  "1. WARA",
  "2. El Cacique S.A.",
  formatCompanyConfirmMessage("El Cacique S.A."),
].join("\n");

let failed = 0;

function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("— Offline: post-empresa → mantenimiento —\n");

assert(
  formatCompanyConfirmMessage("El Cacique S.A.") ===
    "Perfecto, sigo con El Cacique S.A. ¿En qué te puedo ayudar?",
  "confirmación empresa sin doble punto (S.A..)",
);
assert(
  looksLikeOperationalMaintenanceIntent(MAINT_TEXT),
  `"${MAINT_TEXT}" es mantenimiento operativo`,
);
assert(
  looksLikeNonOdometerOperationalIntent(MAINT_TEXT),
  `"${MAINT_TEXT}" no se trata como duplicado/ignorable`,
);
assert(
  classifyTurnExecutor(MAINT_TEXT, THREAD_AFTER_COMPANY) === "mantenimiento",
  `router clasifica → mantenimiento (hilo post-empresa)`,
);
assert(
  !shouldSkipStrayMaintenanceRequest(MAINT_TEXT, THREAD_AFTER_COMPANY, {
    pendingPlateRequest: false,
    pendingMaintConfirm: false,
    lastInbound: "2",
  }),
  "mantenimiento operativo NO hace skipResponse vacío",
);

const CAPABILITY_Q = "Vos podes generar un mantenimiento o lo hago yo?";
const SCHEDULE_WITH_BOT_Q = "Puedo programar uno con vos?";
const THREAD_AFTER_GUIDE = [
  "Para realizar un mantenimiento preventivo en Wara:",
  "1. Ingresa al sistema Wara",
  "Queres que te explique como crear una tarea correctiva tambien?",
].join("\n");
assert(
  looksLikeMaintenanceCapabilityQuestion(SCHEDULE_WITH_BOT_Q, THREAD_AFTER_GUIDE),
  `post-guía "${SCHEDULE_WITH_BOT_Q}" detectada`,
);
assert(
  classifyTurnExecutor(SCHEDULE_WITH_BOT_Q, THREAD_AFTER_GUIDE) === "mantenimiento",
  `post-guía "${SCHEDULE_WITH_BOT_Q}" → mantenimiento (no mudo)`,
);
assert(
  classifyTurnExecutor(CAPABILITY_Q, THREAD_AFTER_GUIDE) === "mantenimiento",
  `post-guía "${CAPABILITY_Q}" → mantenimiento (no mudo)`,
);

const args = process.argv.slice(2);
const live = args.includes("--live");
const phoneArg = args.find((a) => a.startsWith("--phone="));
const phone = phoneArg?.split("=", 2)[1]?.trim() ?? process.env.TEST_WA_PHONE?.trim();

if (live) {
  const apiKey =
    process.env.PULZE_API_KEY?.trim() ||
    process.env.BUILDERBOT_CONTEXT_API_KEY?.trim();
  const base = process.env.WARA_TURN_BASE_URL?.trim() || "http://localhost:3000";
  const turnUrl = `${base}/api/whatsapp/turn`;

  if (!apiKey) {
    console.error("\n✗ --live requiere PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY en el entorno.");
    process.exit(1);
  }
  if (!phone || phone.length < 8) {
    console.error("\n✗ --live requiere --phone=549XXXXXXXXXX (número registrado en Wara).");
    process.exit(1);
  }

  console.log(`\n— Live: POST ${turnUrl} —\n`);

  async function turn(body, label) {
    const res = await fetch(turnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ from: phone, body, api_key: apiKey }),
    });
    const data = await res.json().catch(() => ({}));
    const msg = String(data.message ?? "").trim();
    const skip = data.skipResponse_s === "true";
    const flow = String(data.nextFlow_s ?? data.nextFlow ?? "");
    console.log(`  ${label}`);
    console.log(`    status=${res.status} nextFlow=${flow} skip=${skip}`);
    console.log(`    message=${msg ? msg.slice(0, 120) + (msg.length > 120 ? "…" : "") : "(vacío)"}`);
    return { res, data, msg, skip };
  }

  try {
    const steps = [
      ["Hola", "Paso 1: saludo"],
      ["2", "Paso 2: elegir empresa"],
      [MAINT_TEXT, "Paso 3: mantenimiento (debe pedir patente, no quedar mudo)"],
    ];
    for (const [body, label] of steps) {
      const { res, msg, skip, data } = await turn(body, label);
      if (res.status !== 200) {
        assert(false, `${label}: HTTP ${res.status} ${data.error ?? ""}`);
        break;
      }
      if (body === MAINT_TEXT) {
        assert(!skip && msg.length > 20, `${label}: respuesta con texto (no mudo)`);
        assert(/patente|matr[ií]cula/i.test(msg), `${label}: pide patente`);
      }
    }
  } catch (err) {
    failed++;
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ No se pudo conectar a ${turnUrl}. ¿Corré npm run dev en otra terminal?\n  ${detail}`);
  }
} else {
  console.log("\nTip: probá contra tu Next local sin deploy:");
  console.log("  npm run dev");
  console.log("  npx tsx scripts/simulate-post-company-maintenance.mjs --live --phone=TUNUMERO");
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Simulación post-empresa OK");
