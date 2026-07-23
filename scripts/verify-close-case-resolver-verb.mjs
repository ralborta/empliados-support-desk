#!/usr/bin/env node
/**
 * Regresión, bug real producción 2026-07-23 (mismo hilo: caso 2107263, derivación a
 * asesor humano): el cliente escribió "Quiero resolver el actual caso 2107263" — un
 * pedido explícito de cierre, mencionando el número de caso — y el bot respondió con
 * el estado de GPS de una unidad completamente distinta (MYQ 693, arrastrada por el
 * respaldo de "unidad activa"), generando además un ticket NUEVO sin relación alguna.
 * "Totalmente fuera de contexto", como bien resumió el cliente.
 *
 * Causa: `looksLikeCustomerConversationCloseRequest` (@/lib/customerConversationClose)
 * ya reconocía "resolver el caso" cuando el mensaje EMPIEZA directo con el verbo
 * ("resolver el caso...") pero no en la combinación "quiero/necesito ... resolver ...
 * caso/ticket/..." — esas ramas solo listaban "cerrar/finalizar/terminar", nunca
 * "resolver", así que "quiero resolver el actual caso 2107263" no calificaba como
 * cierre y caía al router genérico → ejecutor de unidades por defecto.
 *
 * El fix agrega "resolver" a esas dos combinaciones, pero SIN sacar el requisito de
 * que además aparezca una palabra de caso/ticket/reclamo/etc. — así "quiero resolver
 * un problema técnico" (que el propio comentario original de la función advierte que
 * NO debe tratarse como cierre) sigue sin matchear, porque "problema" no está en esa
 * lista.
 *
 * Uso: npx tsx scripts/verify-close-case-resolver-verb.mjs
 */
import { looksLikeCustomerConversationCloseRequest } from "../src/lib/customerConversationClose.ts";
import { looksLikeOpenCaseStatusInquiry } from "../src/lib/customerTicketInquiry.ts";
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

console.log("— Bug real: 'quiero resolver el caso' (con o sin número) ahora SÍ es un pedido de cierre —");
const closeRequests = [
  "Quiero resolver el actual caso 2107263",
  "quiero resolver el caso 2107263",
  "Quiero resolver el caso",
  "necesito resolver mi reclamo",
  "necesito resolver el ticket",
];
for (const text of closeRequests) {
  assert(
    looksLikeCustomerConversationCloseRequest(text),
    `looksLikeCustomerConversationCloseRequest("${text}") === true`,
  );
  assert(
    classifyTurnExecutor(text, "") === "odoo_ticket",
    `classifyTurnExecutor("${text}") === "odoo_ticket" (no cae al ejecutor de unidades por defecto)`,
  );
}

console.log(
  "\n— Sanity: 'resolver un PROBLEMA' (técnico, no el caso) sigue SIN tratarse como cierre —",
);
const notCloseRequests = [
  "quiero resolver un problema con mi GPS",
  "necesito resolver un problema técnico",
  "quiero resolver esto de una vez",
];
for (const text of notCloseRequests) {
  assert(
    !looksLikeCustomerConversationCloseRequest(text),
    `looksLikeCustomerConversationCloseRequest("${text}") === false (no es 'caso/ticket/reclamo', no se confunde con cierre)`,
  );
}

console.log("\n— Sanity: pedidos de cierre ya existentes (con 'cerrar') siguen intactos —");
const preExistingCloseRequests = [
  "cerrame el caso",
  "quiero cerrar el caso",
  "dar por resuelto",
  "resolver el caso",
];
for (const text of preExistingCloseRequests) {
  assert(
    looksLikeCustomerConversationCloseRequest(text),
    `looksLikeCustomerConversationCloseRequest("${text}") === true (comportamiento previo intacto)`,
  );
}

console.log(
  "\n— Sanity: looksLikeOpenCaseStatusInquiry sigue excluyendo estos pedidos de cierre (no se solapan) —",
);
assert(
  !looksLikeOpenCaseStatusInquiry("Quiero resolver el actual caso 2107263"),
  "looksLikeOpenCaseStatusInquiry(...) === false (es un cierre, no una consulta de estado)",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación del verbo 'resolver' en pedidos de cierre de caso OK");
