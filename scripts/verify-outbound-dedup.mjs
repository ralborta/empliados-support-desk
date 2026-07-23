#!/usr/bin/env node
/**
 * Regresión del bug real (producción, 2026-07-23, ticket 2107263): dos respuestas
 * legítimas y DISTINTAS del bot (aclaraciones de "¿Cuál unidad?" a dos mensajes reales
 * del cliente, separadas por ~11 segundos) tenían el mismo texto. El webhook
 * `message.outgoing` de BuilderBot para la SEGUNDA se descartaba como "duplicado" en
 * /api/whatsapp/inbound porque el chequeo de deduplicación comparaba solo por texto
 * dentro de una ventana de 2 MINUTOS, sin usar el wamid real (id único de WhatsApp)
 * que el payload sí trae, anidado en `respMessage.messages[0].id`.
 *
 * Consecuencia real: el cliente recibió la segunda respuesta por WhatsApp con
 * normalidad, pero esa respuesta nunca quedó guardada en el panel — justo lo que el
 * cliente pidió blindar antes ("los mensajes deben seguir llegando a la UI").
 *
 * Fix: buildWebhookMessageId ahora también busca el wamid en
 * `respMessage.messages[0].id` / `messages[0].id`, y el chequeo por texto+ventana
 * corta solo corre como respaldo cuando NO hay ningún id estable en el payload.
 *
 * Uso: npx tsx scripts/verify-outbound-dedup.mjs
 */
import { buildWebhookMessageId, hasStableWebhookMessageId } from "../src/lib/webhookMessageId.ts";

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

const phone = "5492612478856";

// Payloads reales (resumidos) de los dos webhooks `message.outgoing` de BuilderBot,
// con el mismo texto de aclaración pero wamid distinto — como ocurrió en producción.
const firstPayload = {
  ref: "791ebfa4-f8df-41ff-926b-0e815a3adb97",
  answer: "¿Cuál unidad? Pasame la matrícula completa o el nombre/marca exacto...",
  from: phone,
  refSerialize: "0cd18e88a45c2651675483c0d67cd4a5",
  respMessage: {
    messages: [{ id: "wamid.HBgNNTQ5MjYxMjQ3ODg1NhUCABEYFENFRjA1NTczNjQ5QzgxMjIwOUE1AA==" }],
  },
  body: "¿Cuál unidad? Pasame la matrícula completa o el nombre/marca exacto...",
};

const secondPayload = {
  ref: "04fe0921-888d-46e4-8097-76fe0fd61436",
  answer: "¿Cuál unidad? Pasame la matrícula completa o el nombre/marca exacto...",
  from: phone,
  refSerialize: "0cd18e88a45c2651675483c0d67cd4a5",
  respMessage: {
    messages: [{ id: "wamid.HBgNNTQ5MjYxMjQ3ODg1NhUCABEYFENFRTgxRUM0QTQxNzkzNDVEMzlCAA==" }],
  },
  body: "¿Cuál unidad? Pasame la matrícula completa o el nombre/marca exacto...",
};

console.log("— buildWebhookMessageId debe extraer el wamid real anidado —");
assert(hasStableWebhookMessageId(firstPayload), "primer payload tiene id estable (wamid en respMessage)");
assert(hasStableWebhookMessageId(secondPayload), "segundo payload tiene id estable (wamid en respMessage)");

console.log("\n— Dos envíos legítimos con el mismo texto NUNCA deben colisionar en el id —");
const id1 = buildWebhookMessageId({ data: firstPayload, phone, direction: "outbound", body: firstPayload.body });
const id2 = buildWebhookMessageId({ data: secondPayload, phone, direction: "outbound", body: secondPayload.body });
assert(id1 !== id2, `los ids son distintos (${id1} !== ${id2}) — no se tratarían como duplicado`);

console.log("\n— Un reintento real del MISMO webhook (mismo wamid) sí debe seguir detectándose —");
const retryOfFirst = { ...firstPayload };
const idRetry = buildWebhookMessageId({ data: retryOfFirst, phone, direction: "outbound", body: retryOfFirst.body });
assert(idRetry === id1, "el mismo wamid genera el mismo id (reintentos siguen siendo detectados)");

console.log("\n— Payload sin ningún id de proveedor cae al respaldo por hash (y se marca como no-estable) —");
const noIdPayload = { answer: "Hola", from: phone, body: "Hola" };
assert(!hasStableWebhookMessageId(noIdPayload), "sin ids reconocidos, hasStableWebhookMessageId es false");

if (failed > 0) {
  console.error(`\n✗ ${failed} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ Verificación de deduplicación de mensajes salientes OK (sin falsos positivos por texto repetido)");
