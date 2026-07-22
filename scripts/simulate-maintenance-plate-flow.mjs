#!/usr/bin/env node
/**
 * Simula el flujo completo: guía mantenimiento → programar con vos → AD / prefijo.
 * Offline por defecto; --live --phone=... contra prod o local.
 */
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import {
  hasPendingMaintenancePlateRequest,
  hasPendingMantenimientoConfirmation,
} from "../src/lib/wara.ts";
import {
  looksLikeMaintenanceExplorationRequest,
  looksLikeMaintenanceInfoRequest,
  looksLikeMaintenanceCapabilityQuestion,
  looksLikeOperationalMaintenanceIntent,
  shouldSkipStrayMaintenanceRequest,
} from "../src/lib/waraApi.ts";
import {
  isMaintenancePlateSelectionMessage,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";

let failed = 0;

function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function route(text, thread = "") {
  return classifyTurnExecutor(text, thread);
}

const GUIDE_THREAD = [
  "El módulo de mantenimiento sirve para gestionar tareas preventivas y correctivas.",
  "¿Querés que te guíe paso a paso para crear un plan o una tarea?",
].join("\n");

const CAPABILITY_REPLY = [
  "Sí, yo puedo registrar o programar un mantenimiento por acá en WhatsApp.",
  "Decime la patente de la unidad y si es preventivo o correctivo (y un detalle breve si querés).",
  "Yo lo dejo cargado en Wara.",
].join("\n");

const THREAD_AFTER_CAPABILITY = [GUIDE_THREAD, CAPABILITY_REPLY].join("\n");

const fleetUnits = [
  { movil_id: 1, patente: "AD 427 MC", unidad: "CAMION 1" },
  { movil_id: 2, patente: "AD 999 XX", unidad: "CAMION 2" },
  { movil_id: 3, patente: "OST 223", unidad: "900-041" },
];

console.log("— Mantenimiento: guía → programar con vos → patente —\n");

assert(
  looksLikeMaintenanceInfoRequest("Quiero saber sobre mantenimiento"),
  "saber sobre mantenimiento = info (no flota)",
);
assert(
  !looksLikeOperationalMaintenanceIntent("Quiero saber sobre mantenimiento"),
  "saber sobre NO es operativo",
);
assert(route("Quiero saber sobre mantenimiento", GUIDE_THREAD) === "info_guides", "saber sobre → guía backend");

assert(
  looksLikeMaintenanceCapabilityQuestion("Puedo programar un mantenimiento con vos?", GUIDE_THREAD),
  "programar con vos detectado",
);
assert(route("Puedo programar un mantenimiento con vos?", GUIDE_THREAD) === "mantenimiento", "programar con vos → mantenimiento");

assert(hasPendingMaintenancePlateRequest(THREAD_AFTER_CAPABILITY), "pedido de patente tras capability");
assert(route("AD", THREAD_AFTER_CAPABILITY) === "mantenimiento", "AD tras pedido patente → mantenimiento");
assert(
  route("AD", THREAD_AFTER_CAPABILITY) !== "info_guides",
  "AD NO va a info_guides tras guía + pedido patente",
);
assert(route("La q comienza con AD", THREAD_AFTER_CAPABILITY) === "mantenimiento", "prefijo AD → mantenimiento");

assert(
  !shouldSkipStrayMaintenanceRequest("AD", THREAD_AFTER_CAPABILITY, {
    pendingPlateRequest: true,
    pendingMaintConfirm: false,
  }),
  "AD con pendingPlate NO se silencia (skip)",
);
assert(
  !shouldSkipStrayMaintenanceRequest("La q comienza with AD", THREAD_AFTER_CAPABILITY, {
    pendingPlateRequest: true,
    pendingMaintConfirm: false,
  }),
  "prefijo AD NO se silencia",
);

assert(isMaintenancePlateSelectionMessage("AD"), "AD es selección de patente");
assert(isMaintenancePlateSelectionMessage("La q comienza con AD"), "frase prefijo es selección");
assert(!isMaintenancePlateSelectionMessage("Quiero hacer un mantenimiento"), "inicio trámite NO es selección");

assert(
  route("Quiero hacer un mantenimiento", THREAD_AFTER_CAPABILITY) === "mantenimiento",
  "reinicio trámite → mantenimiento",
);
assert(
  !looksLikeMaintenanceExplorationRequest("Quiero hacer un mantenimiento"),
  "hacer mantenimiento es operativo",
);

const longMaintThread = [
  ...Array(8).fill("mensaje previo del hilo"),
  "Voy a registrar:",
  "Patente: AD427MC",
  "Tipo: Plan de mantenimiento",
  "Prioridad: normal",
  "Detalle: Mantenimiento preventivo para AD 427 MC",
  "Si esta correcto, responde CONFIRMO para registrarlo.",
].join("\n");
assert(hasPendingMantenimientoConfirmation(longMaintThread), "confirmación pendiente en hilo largo");
assert(route("Confirmo", longMaintThread) === "mantenimiento", "Confirmo → mantenimiento (no loop)");

const adRules = await resolveUnitQuery({
  rawText: "AD",
  threadText: THREAD_AFTER_CAPABILITY,
  units: fleetUnits,
});
assert(adRules.intent === "need_clarification", "AD offline reglas → aclaración (2 unidades AD)");
assert((adRules.clarificationQuestion ?? "").includes("AD 427 MC"), "AD lista candidatos del catálogo");

const args = process.argv.slice(2);
const live = args.includes("--live");
const prod = args.includes("--prod");
const phoneArg = args.find((a) => a.startsWith("--phone="));
const phone = phoneArg?.split("=", 2)[1]?.trim() ?? process.env.TEST_WA_PHONE?.trim();

if (live) {
  const apiKey =
    process.env.PULZE_API_KEY?.trim() ||
    process.env.BUILDERBOT_CONTEXT_API_KEY?.trim();
  const base =
    process.env.WARA_TURN_BASE_URL?.trim() ||
    (prod ? "https://wara.nivel41.com" : "http://localhost:3000");
  const turnUrl = `${base}/api/whatsapp/turn`;

  if (!apiKey) {
    console.error("\n✗ --live requiere PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY");
    process.exit(1);
  }
  if (!phone || phone.length < 8) {
    console.error("\n✗ --live requiere --phone=549XXXXXXXXXX");
    process.exit(1);
  }

  console.log(`\n— Live: ${turnUrl} —\n`);

  async function turn(body, label) {
    const res = await fetch(turnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ from: phone, body, api_key: apiKey }),
    });
    const data = await res.json().catch(() => ({}));
    const msg = String(data.message ?? data.summaryText ?? "").trim();
    const skip = data.skipResponse_s === "true";
    console.log(`  ${label}`);
    console.log(`    skip=${skip} executor=${data.executor_s ?? data.executor ?? "?"}`);
    console.log(`    ${msg ? msg.slice(0, 200) + (msg.length > 200 ? "…" : "") : "(vacío)"}`);
    return { res, data, msg, skip };
  }

  try {
    const steps = [
      ["Quiero saber sobre mantenimiento", "Info mantenimiento"],
      ["Puedo programar un mantenimiento con vos?", "Capability"],
      ["AD", "Prefijo AD"],
    ];
    for (const [body, label] of steps) {
      const { res, msg, skip } = await turn(body, label);
      assert(res.status === 200, `${label}: HTTP ${res.status}`);
      assert(!skip, `${label}: no skipResponse`);
      assert(msg.length > 10, `${label}: respuesta con texto`);
      if (body === "AD") {
        assert(
          /AD 427|patente|matr[ií]cula|CONFIRMO|Voy a registrar/i.test(msg),
          `${label}: resuelve unidad o pide confirmación`,
        );
      }
    }
  } catch (err) {
    failed++;
    console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  }
} else {
  console.log("\nLive prod (con API key):");
  console.log("  npx tsx scripts/simulate-maintenance-plate-flow.mjs --live --prod --phone=TUNUMERO");
}

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Simulación mantenimiento + patente OK");
