#!/usr/bin/env node
/**
 * Bug real 2026-08-22/23:
 * - "Indícame el reporte de la nissan" → sin match en flota + silencio (BBC no entregó).
 * - GPS con media + caption " " → WhatsApp mostraba solo ".".
 *
 * Uso: npx tsx scripts/verify-never-silent-delivery.mjs
 */
import assert from "node:assert/strict";
import { shouldTurnSendWhatsAppToCustomer } from "../src/lib/waraInboundAudit.ts";
import {
  buildFleetUnitNotFoundMessage,
  extractBrandSearchLabel,
  resolveUnitQuery,
} from "../src/lib/waraUnitIntent.ts";
import { classifyTurnExecutor } from "../src/lib/whatsappTurnRouter.ts";
import { looksLikeGpsOrUnitStatusQuestion, looksLikeLiveUnitConsultIntent } from "../src/lib/waraApi.ts";

const ask = "Indícame el reporte de la nissan";

assert.equal(extractBrandSearchLabel(ask), "nissan", "extrae marca nissan");
assert.equal(looksLikeGpsOrUnitStatusQuestion(ask), true, "es consulta GPS");
assert.equal(looksLikeLiveUnitConsultIntent(ask), true, "live unit consult");
assert.equal(classifyTurnExecutor(ask, "Atilio: Hola"), "unidades", "enruta a unidades");

const fleetWithNissan = [
  { movil_id: 1, patente: "AG562SP", unidad: "NISSAN 2404 - AG 562 SP", marca: "Nissan", modelo: "2404" },
  { movil_id: 2, patente: "AD427MC", unidad: "Saveiro", marca: "VW" },
];
const hit = await resolveUnitQuery({
  rawText: ask,
  threadText: "",
  units: fleetWithNissan,
  preferAi: false,
});
assert.equal(hit.intent, "consult_status", "con Nissan en flota → consult_status");
assert.equal(hit.plate, "AG562SP", "resuelve AG562SP");

const fleetNoNissan = [
  { movil_id: 1, patente: "AD427MC", unidad: "Saveiro", marca: "VW" },
  { movil_id: 2, patente: "AF061DO", unidad: "Hilux", marca: "Toyota" },
];
const miss = await resolveUnitQuery({
  rawText: ask,
  threadText: "",
  units: fleetNoNissan,
  preferAi: false,
});
assert.equal(miss.intent, "need_clarification", "sin Nissan → need_clarification");
assert.equal(miss.candidatePlates.length, 0, "sin candidatos inventados");
const notFound = miss.clarificationQuestion || buildFleetUnitNotFoundMessage({ searchedText: "nissan" });
assert.match(notFound, /nissan/i, "mensaje nombra nissan");
assert.match(notFound, /no encontr/i, "mensaje es no encontré");

const prev = process.env.WARA_TURN_BACKEND_SEND;
delete process.env.WARA_TURN_BACKEND_SEND;
assert.equal(shouldTurnSendWhatsAppToCustomer(), true, "default backend send = true");
process.env.WARA_TURN_BACKEND_SEND = "false";
assert.equal(shouldTurnSendWhatsAppToCustomer(), false, "rollback explícito false");
process.env.WARA_TURN_BACKEND_SEND = "true";
assert.equal(shouldTurnSendWhatsAppToCustomer(), true, "true explícito");
if (prev === undefined) delete process.env.WARA_TURN_BACKEND_SEND;
else process.env.WARA_TURN_BACKEND_SEND = prev;

// Contrato anti-duplicado (bug 2026-08-23): tras envío API, BBC no debe recibir el texto.
{
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/lib/whatsappTurnDelivery.ts", import.meta.url), "utf8"),
  );
  assert.match(src, /deliveredMessage/, "guarda deliveredMessage para auditoría");
  assert.match(src, /message:\s*""/, "vacía message tras API OK");
  assert.match(src, /summaryText:\s*""/, "vacía summaryText tras API OK");
}

console.log("✓ verify-never-silent-delivery OK");
