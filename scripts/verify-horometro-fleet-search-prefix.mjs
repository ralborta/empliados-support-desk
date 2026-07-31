#!/usr/bin/env node
/**
 * Regresión bug real 2026-07-30: horómetro + Nissan → pidió hs sin resolver unidad;
 * "ag" / "no lo se" deben buscar en flota (prefijo/marca), no pedir solo patente completa.
 *
 * Uso: npx tsx scripts/verify-horometro-fleet-search-prefix.mjs
 */
import assert from "node:assert";
import {
  isOdometerPlateSelectionMessage,
  looksLikeFleetUnitSearchInput,
  resolveUnitQuery,
  shouldRouteTurnToOdometerExecutor,
} from "../src/lib/waraUnitIntent.ts";
import {
  looksLikePatenteUnknownReply,
  shouldContinueOdometerFlow,
} from "../src/lib/waraApi.ts";
import { threadAwaitingHorometerPlate } from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let passed = 0;
function check(label, cond) {
  assert.ok(cond, label);
  passed++;
  console.log(`  ✓ ${label}`);
}

const fleet = [
  { movil_id: 1, patente: "AG 562 SP", unidad: "NISSAN 2404" },
  { movil_id: 2, patente: "AG 701 XK", unidad: "NISSAN FRONTIER" },
];

const threadAfterHoroAsk = [
  "Cliente: quiero cambiar el horometro de la Nissan",
  "Bot: Perfecto, para la Nissan. Cual es el nuevo horometro en horas?",
  "Cliente: 44",
  "Bot: Me confirmas la patente de la Nissan?",
  "Cliente: no lo se",
].join("\n");

console.log("— Arranque con marca Nissan → búsqueda en flota —");
const nissanStart = await resolveUnitQuery({
  rawText: "quiero cambiar el horometro de la Nissan",
  threadText: "",
  units: fleet,
  preferAi: false,
  odometerContext: true,
});
check(
  "Nissan lista similares (no pide patente a ciegas)",
  nissanStart.intent === "need_clarification" && nissanStart.candidatePlates.length === 2,
);
check(
  "mensaje incluye patentes AG",
  /AG\s*562|562\s*SP|701/.test(nissanStart.clarificationQuestion ?? ""),
);

console.log("\n— Prefijo AG tras trámite horómetro —");
check("ag es búsqueda de flota", looksLikeFleetUnitSearchInput("ag") === true);
check("ag es selección odómetro", isOdometerPlateSelectionMessage("ag") === true);
const agResolved = await resolveUnitQuery({
  rawText: "ag",
  threadText: threadAfterHoroAsk,
  units: fleet,
  preferAi: false,
  odometerContext: true,
});
check(
  "ag lista unidades que empiezan con AG",
  agResolved.intent === "need_clarification" && agResolved.candidatePlates.length === 2,
);
check(
  "classifyTurnExecutor('ag') → odometro",
  classifyTurnExecutor("ag", threadAfterHoroAsk) === "odometro",
);
check(
  "shouldRouteTurnToOdometerExecutor('ag')",
  shouldRouteTurnToOdometerExecutor({
    selectionText: "ag",
    threadText: threadAfterHoroAsk,
    pendingActionType: null,
  }) === true,
);

console.log("\n— 'no lo se' durante pedido de patente —");
check("detecta no recuerda patente", looksLikePatenteUnknownReply("no lo se") === true);
check(
  "sigue en flujo odómetro",
  shouldContinueOdometerFlow("no lo se", threadAfterHoroAsk) === true,
);
check(
  "isOdometerPlateSelectionMessage('no lo se')",
  isOdometerPlateSelectionMessage("no lo se") === true,
);

console.log("\n— Detección de pedido de patente (IA o plantilla) —");
check(
  "threadAwaitingHorometerPlate detecta confirmación de patente",
  threadAwaitingHorometerPlate(
    "Bot: Me confirmas la patente de la Nissan?\nBot: Cual es el nuevo horometro en horas?",
  ) === true,
);

console.log(`\n✅ ${passed} checks pasaron.`);
