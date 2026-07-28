#!/usr/bin/env node
/**
 * Regresión producción 2026-07-28: dentro de un trámite de certificado, "la q empieza
 * con OST" hace que la resolución de flota devuelva el mensaje GENÉRICO de aclaración
 * de prefijo/candidatos ("Encontré N unidades que empiezan con OST (...). Decime cuál
 * querés consultar (patente exacta).") — el mismo texto compartido que usa la
 * resolución de flota para ESTADO/GPS/mantenimiento, sin mencionar "certificado" en
 * ningún lado.
 *
 * threadHasCertificateUnitPrompt() no reconocía ese mensaje como continuación del
 * certificado, así que certificateFlowState volvía a "none" y la siguiente selección
 * de unidad ("la OST226") se enrutaba al chequeo de GPS/estado en vez de continuar el
 * certificado — el cliente recibía un reporte de ignición ("está detenida... no se
 * generará un ticket...") en vez de su certificado.
 *
 * Adicionalmente, el pedido original tenía un typo de teclado real ("ceryficado", no
 * una simple letra repetida) que looksLikeCertificateKeyword tampoco reconocía.
 */
import {
  threadHasCertificateUnitPrompt,
  certificateFlowState,
  looksLikeCertificateKeyword,
} from "../src/lib/wara.ts";
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
  looksLikeCertificateKeyword("ahora quiero q emitas un ceryficado"),
  "typo de teclado 'ceryficado' se reconoce como pedido de certificado",
);
assert(
  !looksLikeCertificateKeyword("tengo la certeza de que funciona"),
  "'certeza' NO es un falso positivo de 'certificado'",
);
assert(
  !looksLikeCertificateKeyword("la unidad esta cerca del taller"),
  "'cerca' NO es un falso positivo de 'certificado'",
);

const thread = [
  "Cliente: ahora quiero q emitas un ceryficado",
  "Bot: ¿Cuál unidad? Pasame la matrícula completa o el nombre/marca exacto para buscarla en la flota de tu empresa. Si querés ver todas, escribí «listado de mis unidades».",
  "Cliente: la q empieza con OST",
  "Bot: Encontré 4 unidades que empiezan con OST (OST 223, OST 226, OST 224, OST 225). Decime cuál querés consultar (patente exacta).",
].join("\n");

assert(
  threadHasCertificateUnitPrompt(thread),
  "threadHasCertificateUnitPrompt reconoce la aclaración de prefijo como continuación del certificado",
);
assert(
  certificateFlowState(thread) === "awaiting_unit",
  `certificateFlowState sigue awaiting_unit tras la aclaración de prefijo (obtuvo ${certificateFlowState(thread)})`,
);
assert(
  classifyTurnExecutor("la OST226", thread) === "certificados",
  `'la OST226' se enruta a certificados, no a unidades/GPS (obtuvo ${classifyTurnExecutor("la OST226", thread)})`,
);

// Variante con el mensaje de aclaración "genérico" (sin listar prefijo específico),
// como el que devuelve la IA cuando no hay match de reglas.
const threadGenericClarification = [
  "Cliente: quiero un certificado de cobertura",
  "Bot: ¿Cuál unidad? Pasame la matrícula completa o el nombre/marca exacto para buscarla en la flota de tu empresa. Si querés ver todas, escribí «listado de mis unidades».",
  "Cliente: la nissan",
  "Bot: Encontré varias unidades posibles. Decime la matrícula exacta.",
].join("\n");
assert(
  certificateFlowState(threadGenericClarification) === "awaiting_unit",
  "certificateFlowState también sigue awaiting_unit con la aclaración genérica de la IA",
);

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log(
  "\n✓ El trámite de certificado sobrevive a una ronda de aclaración de prefijo/candidatos sin perder el hilo",
);
