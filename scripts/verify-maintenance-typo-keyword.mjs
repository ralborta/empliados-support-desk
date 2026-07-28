#!/usr/bin/env node
/**
 * Regresión producción 2026-07-28: "me ayudasa agendar un mantenimineto?" (typo de
 * teclado real sobre "mantenimiento", no una letra repetida) no matcheaba ningún
 * \b(mantenimiento|preventiv\w*|correctiv\w*)\b literal en TODA la cadena de detección
 * (looksLikeMaintenanceExplorationRequest, looksLikeOperationalMaintenanceIntent,
 * looksLikeMaintenanceOperational del router) — el pedido caía al fallback genérico de
 * "consulta operativa" (unidades/GPS) y, tras resolver la unidad por prefijo (OST226),
 * terminaba devolviendo el estado de ignición de la unidad en vez de agendar el
 * mantenimiento.
 */
import { looksLikeMaintenanceKeyword, hasPendingMaintenancePlateRequest } from "../src/lib/wara.ts";
import { looksLikeOperationalMaintenanceIntent, looksLikeMaintenanceExplorationRequest } from "../src/lib/waraApi.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

assert(
  looksLikeMaintenanceKeyword("me ayudasa agendar un mantenimineto?"),
  "typo 'mantenimineto' se reconoce como palabra clave de mantenimiento",
);
assert(!looksLikeMaintenanceKeyword("esta correcto"), "'correcto' NO es falso positivo de mantenimiento");
assert(!looksLikeMaintenanceKeyword("perfecto, correcto"), "'correcto' (variante) NO es falso positivo");
assert(!looksLikeMaintenanceKeyword("confirmo"), "'confirmo' NO es falso positivo");
assert(!looksLikeMaintenanceKeyword("quiero un certificado"), "'certificado' NO es falso positivo de mantenimiento");

assert(
  !looksLikeMaintenanceExplorationRequest("me ayudasa agendar un mantenimineto?"),
  "'agendar' con typo se reconoce como trámite operativo, no exploración/guía",
);
assert(
  looksLikeOperationalMaintenanceIntent("me ayudasa agendar un mantenimineto?", ""),
  "looksLikeOperationalMaintenanceIntent reconoce el pedido con el typo",
);

const threadStart = [
  "Cliente: cambiar de empresa",
  "Bot: Listo, reinicié la empresa y limpié el historial de conversación. ¿Con cuál seguimos?\n\n1. WARA\n2. El Cacique S.A.\n\nRespondé con el número de la opción o con el nombre de la empresa.",
  "Cliente: 2",
  "Bot: Perfecto, sigo con El Cacique S.A. ¿En qué te puedo ayudar?",
].join("\n");

assert(
  classifyTurnExecutor("me ayudasa agendar un mantenimineto?", threadStart) === "mantenimiento",
  `el pedido con typo se enruta a mantenimiento (obtuvo ${classifyTurnExecutor("me ayudasa agendar un mantenimineto?", threadStart)})`,
);

const threadAfterPlateAsk = [
  threadStart,
  "Cliente: me ayudasa agendar un mantenimineto?",
  "Bot: Para programar mantenimiento preventivo necesito la patente de la unidad (por ejemplo AD427MC o ABC123). Si querés, agregá también la prioridad.",
  "Cliente: para un con patente OST",
  "Bot: Encontré 4 unidades que empiezan con OST (OST 223, OST 226, OST 224, OST 225). Decime cuál querés consultar (patente exacta).",
].join("\n");

assert(
  hasPendingMaintenancePlateRequest(threadAfterPlateAsk),
  "el hilo sigue con pedido de patente de mantenimiento pendiente tras la aclaración de prefijo",
);
assert(
  classifyTurnExecutor("OST226", threadAfterPlateAsk) === "mantenimiento",
  `la selección final de unidad se enruta a mantenimiento, no a unidades/GPS (obtuvo ${classifyTurnExecutor("OST226", threadAfterPlateAsk)})`,
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log(
  "\n✓ Un typo de teclado sobre 'mantenimiento' ('mantenimineto') no rompe el trámite operativo de agendar mantenimiento",
);
