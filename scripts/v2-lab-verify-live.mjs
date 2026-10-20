#!/usr/bin/env node
/**
 * Verificación live: persistencia + GPS lateral + cero escrituras.
 * Requiere WARA_V2_TURN_API_KEY en entorno.
 */
import { randomUUID } from "node:crypto";

const BASE = (process.env.WARA_V2_LAB_URL ?? "https://wara-v2.wd75db.easypanel.host").replace(/\/+$/, "");
const KEY = process.env.WARA_V2_TURN_API_KEY?.trim() ?? "";
const PHONE = process.env.WARA_V2_LAB_PHONE ?? "+5491133788190";

if (!KEY) {
  console.error("Falta WARA_V2_TURN_API_KEY");
  process.exit(1);
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { "x-api-key": KEY }, cache: "no-store" });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

async function reset() {
  await post("/api/pilot/reset", { phone: PHONE });
}

async function turn(text: string) {
  const { status, json } = await post("/api/whatsapp/turn", {
    from: PHONE,
    body: text,
    messageId: randomUUID(),
  });
  const msg = String(json.message ?? "");
  console.log(`→ ${text}`);
  console.log(`← [${status}] ${msg.slice(0, 400)}`);
  return { status, message: msg, json };
}

async function state() {
  const q = new URLSearchParams({ phone: PHONE });
  return get(`/api/pilot/state?${q}`);
}

console.log("=== Health ===");
console.log(JSON.stringify(await get("/health").then((r) => r.json), null, 2));

console.log("\n=== 1. Persistencia mid-flow (antes reinicio) ===");
await reset();
await turn("listas de unidades");
await turn("2");
await turn("listas de unidades");
await turn("1");
await turn("odometro");
await turn("130500 km");
await turn("06/08/2026 15:50");
const before = await state();
console.log("STATE_BEFORE:", JSON.stringify(before.json, null, 2));

console.log("\n=== 2. GPS lateral live ===");
await reset();
await turn("listas de unidades");
await turn("2");
await turn("listas de unidades");
await turn("1");
await turn("odometro");
await turn("130500 km");
await turn("06/08/2026 15:50");
await turn("¿dónde está el vehículo?");
await turn("continuamos");
const confirmGps = await turn("CONFIRMO");
console.log("CONFIRMO_AFTER_GPS:", confirmGps.message.slice(0, 200));

console.log("\n=== 3. Idempotencia post-completar (simular reinicio lógico) ===");
const dup = await turn("CONFIRMO");
console.log("DUP_CONFIRMO:", dup.message.slice(0, 120));

console.log("\n=== Health final ===");
console.log(JSON.stringify(await get("/health").then((r) => r.json), null, 2));
