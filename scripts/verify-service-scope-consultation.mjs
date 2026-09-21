#!/usr/bin/env node
/**
 * Meta-consultas ("¿puedo hacer una consulta?") → respuesta breve acotada a servicios Wara.
 */
import assert from "node:assert/strict";

const { looksLikeServiceScopeConsultationMeta } = await import("../src/lib/waraApi.ts");
const { buildBriefServiceScopeConsultationReply } = await import("../src/lib/waraWhatsAppFormat.ts");
const { classifyTurnExecutor } = await import("../src/lib/whatsappTurnRouter.ts");

const meta = [
  "puedo hacer una consulta",
  "tengo una consulta",
  "quería hacerte una consulta",
  "te puedo consultar algo?",
  "es solo una consulta",
];

for (const text of meta) {
  assert.equal(looksLikeServiceScopeConsultationMeta(text), true, `meta: ${text}`);
}

const concrete = [
  "puedo hacer una consulta del certificado de cobertura",
  "tengo una consulta sobre el GPS de la Nissan",
  "quiero consultar el estado de AB 000 MW",
  "necesito mantenimiento preventivo",
];

for (const text of concrete) {
  assert.equal(
    looksLikeServiceScopeConsultationMeta(text),
    false,
    `NO meta (tema concreto): ${text}`,
  );
}

const reply = buildBriefServiceScopeConsultationReply();
assert.match(reply, /GPS\/reporte/i);
assert.match(reply, /od[oó]metro/i);
assert.match(reply, /certificados/i);
assert.match(reply, /mantenimiento/i);
assert.ok(reply.length < 280, "respuesta breve");

assert.equal(
  classifyTurnExecutor("puedo hacer una consulta", ""),
  "unidades",
  "meta-consulta no va a mantenimiento por defecto",
);

console.log("OK verify-service-scope-consultation");
