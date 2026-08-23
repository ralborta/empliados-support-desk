#!/usr/bin/env node
/**
 * Clientes en WARA_PROTECTED_CLIENT_PHONES: no recibir WA por API manual sin wamid.
 */
import assert from "node:assert/strict";
import {
  isProtectedClientPhone,
  shouldDeliverWhatsAppToProtectedClient,
} from "../src/lib/waraTurnDeliveryGuard.ts";

process.env.WARA_PROTECTED_CLIENT_PHONES = "5492612478856";

assert(isProtectedClientPhone("5492612478856"), "teléfono protegido");
assert(!isProtectedClientPhone("5491133788190"), "teléfono test no protegido");

const blockedManual = await shouldDeliverWhatsAppToProtectedClient("5492612478856", "Hola", {
  messageId: "wa-smoke-test",
});
assert.equal(blockedManual, false, "smoke messageId bloqueado");

const allowedWamid = await shouldDeliverWhatsAppToProtectedClient("5492612478856", "Hola", {
  messageId: "wamid.HBgLNTQ5MjYxMjQ3ODg1Ng",
});
assert.equal(allowedWamid, true, "wamid en turn permite entrega");

const unprotected = await shouldDeliverWhatsAppToProtectedClient("5491133788190", "Hola");
assert.equal(unprotected, true, "teléfono no protegido siempre entrega");

console.log("OK verify-protected-turn-delivery");
