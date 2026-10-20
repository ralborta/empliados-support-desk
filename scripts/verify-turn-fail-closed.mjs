import assert from "node:assert/strict";
import { handleWhatsAppTurnFailClosed } from "../src/app/api/whatsapp/turn/route.ts";

const params = {
  rawPhone: "5490000000888",
  body: "Hola",
  apiKey: "test",
};

const normalPayload = { ok: true, ok_s: "true", message: "Respuesta nueva" };
const normal = await handleWhatsAppTurnFailClosed(params, {
  handleTurn: async () => normalPayload,
  sendMessage: async () => {
    throw new Error("No debe enviar fallback en el recorrido normal");
  },
});
assert.equal(normal, normalPayload);

let sent;
const failed = await handleWhatsAppTurnFailClosed(params, {
  handleTurn: async () => {
    throw new Error("database unavailable");
  },
  sendMessage: async (payload) => {
    sent = payload;
    return { id: "fallback-provider-id" };
  },
});
assert.deepEqual(sent, {
  number: params.rawPhone,
  message: "Tuve un inconveniente procesando la consulta. Intentá nuevamente en unos minutos.",
});
assert.equal(failed.ok_s, "false");
assert.equal(failed.message, "");
assert.equal(failed.skipResponse_s, "true");
assert.equal(failed.waSent_s, "true");
assert.equal(failed.waDelivery_s, "backend_fail_closed");

const deliveryAlsoFailed = await handleWhatsAppTurnFailClosed(params, {
  handleTurn: async () => {
    throw new Error("database unavailable");
  },
  sendMessage: async () => {
    throw new Error("provider unavailable");
  },
});
assert.equal(deliveryAlsoFailed.message, "");
assert.equal(deliveryAlsoFailed.skipResponse_s, "true");
assert.equal(deliveryAlsoFailed.waSent_s, "false");
assert.equal(deliveryAlsoFailed.waDelivery_s, "failed");

console.log("OK verify-turn-fail-closed");
