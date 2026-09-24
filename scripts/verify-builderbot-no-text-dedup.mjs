#!/usr/bin/env node
/**
 * Runtime: sendWhatsAppMessage no deduplica por teléfono+texto (sin ventana 8s).
 * Uso: npx tsx scripts/verify-builderbot-no-text-dedup.mjs
 */
import assert from "node:assert/strict";

process.env.BUILDERBOT_BOT_ID = "runtime-test-bot";
process.env.BUILDERBOT_API_KEY = "runtime-test-key";

const { sendWhatsAppMessage, setBuilderBotHttpPostForTests } = await import(
  "../src/lib/builderbot.ts"
);

let postCount = 0;
setBuilderBotHttpPostForTests(async () => {
  postCount++;
  return { data: { messages: [{ id: `wamid.runtime.${postCount}` }] } };
});

const phone = "5491133788190";
const text = "mismo texto sin dedup textual";
await sendWhatsAppMessage({ number: phone, message: text });
await sendWhatsAppMessage({ number: phone, message: text });
assert.equal(postCount, 2, "dos POST API con mismo texto");

let lastBody = "";
setBuilderBotHttpPostForTests(async (_url, payload) => {
  lastBody = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload);
  return { data: { messages: [{ id: "wamid.filename" }] } };
});
await sendWhatsAppMessage({
  number: phone,
  message: "Guia",
  mediaUrl: "https://wara.nivel41.com/guides/como-cargo-mi-numero-en-wara.pdf",
});
assert.match(lastBody, /Como cargo mi numero en la plataforma Wara\.pdf/, "fileName limpio en BBC");
assert.doesNotMatch(lastBody, /1790\d+|f86f1433c/, "sin sufijo numérico en fileName");

setBuilderBotHttpPostForTests(null);
console.log("✓ verify-builderbot-no-text-dedup OK");
