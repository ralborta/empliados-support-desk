#!/usr/bin/env node
/**
 * Desbloquea un contacto en BuilderBot Cloud (mute del runtime + blacklist).
 * Uso: node scripts/unmute-builderbot-contact.mjs 5491133788190
 */
import axios from "axios";

const BOT_ID = process.env.BUILDERBOT_BOT_ID || "";
const API_KEY = process.env.BUILDERBOT_API_KEY || "";
const phone = (process.argv[2] || "").replace(/\D/g, "");

if (!BOT_ID || !API_KEY) {
  console.error("Faltan BUILDERBOT_BOT_ID y BUILDERBOT_API_KEY");
  process.exit(1);
}
if (phone.length < 9) {
  console.error("Indicá un teléfono: node scripts/unmute-builderbot-contact.mjs 5491133788190");
  process.exit(1);
}

const base = `https://app.builderbot.cloud/api/v2/${BOT_ID}`;
const headers = { "Content-Type": "application/json", "x-api-builderbot": API_KEY };

const mute = await axios.post(`${base}/mute`, { number: phone, status: false }, { headers });
console.log("mute:", mute.data);

const bl = await axios.post(`${base}/blacklist`, { number: phone, intent: "remove" }, { headers });
console.log("blacklist:", bl.data);
