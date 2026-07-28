#!/usr/bin/env node
/**
 * Regresión producción 2026-07-28: tras "Para programar mantenimiento preventivo
 * necesito la patente de la unidad...", el cliente respondió con una referencia VAGA
 * ("para la misma unidad", refiriéndose a la HEJ ya resuelta antes en el hilo) en vez
 * de una patente/prefijo/nombre explícito.
 *
 * isUnitSelectionMessage() (usado por la regla de router "pending_maintenance_plate_selection")
 * e isMaintenancePlateSelectionMessage() (usado dentro del propio ejecutor de
 * mantenimiento) no reconocían esa referencia vaga como "el cliente está indicando la
 * unidad" — el mensaje caía al fallback genérico de "consulta operativa" y terminaba
 * en el chequeo de GPS/estado (repitiendo el mismo reporte de falta de reporte en
 * loop) en vez de continuar el trámite de mantenimiento pendiente.
 */
import { hasPendingMaintenancePlateRequest } from "../src/lib/wara.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { isMaintenancePlateSelectionMessage } from "../src/lib/waraUnitIntent.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const thread = [
  "Cliente: lista de unidades",
  "Bot: Tenés 73 unidades en WARA. Te muestro 8 como referencia: AB006EXCANBUS, Alarma 1er Piso, ALARMA2DOPISO, ALARMAPB, ALEJANDROPICÓN, HEJ (nombre Alex Lima), I864520060172162 (nombre Alex Lima), LWK 7902 (nombre BRtestes) y 65 más.",
  "Cliente: de la patente HEJ",
  "Bot: La unidad HEJ (nombre Alex Lima) presenta falta de reporte, ya que el GPS no envía datos desde hace 193 días. He generado el caso N° 36053 para Atención al cliente. La ignición se encuentra encendida, pero no se recibe información de la ubicación.",
  "Cliente: ok quiero agendar una mantenimiento preventivo",
  "Bot: Para programar mantenimiento preventivo necesito la patente de la unidad (por ejemplo AD427MC o ABC123). Si querés, agregá también la prioridad.",
].join("\n");

assert(
  isMaintenancePlateSelectionMessage("para la misma unidad"),
  "'para la misma unidad' se reconoce como selección de patente para mantenimiento",
);
assert(
  hasPendingMaintenancePlateRequest(thread),
  "el hilo tiene pendiente el pedido de patente para mantenimiento",
);
assert(
  classifyTurnExecutor("para la misma unidad", thread) === "mantenimiento",
  `'para la misma unidad' se enruta a mantenimiento, no a unidades/GPS (obtuvo ${classifyTurnExecutor("para la misma unidad", thread)})`,
);

// Variante con el typo real de producción ("qwuiero" en vez de "quiero").
assert(
  classifyTurnExecutor("qwuiero agendar un mantenimiento para la misma unidad", thread) === "mantenimiento",
  "variante con typo 'qwuiero' también se enruta a mantenimiento",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log(
  "\n✓ Una referencia vaga a la unidad ('para la misma unidad') continúa el trámite de mantenimiento pendiente",
);
