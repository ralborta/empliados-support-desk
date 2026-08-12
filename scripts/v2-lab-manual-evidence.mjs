#!/usr/bin/env node
/**
 * Conversaciones manuales V2 lab (replay HTTP, no WhatsApp real).
 * Requiere: WARA_V2_LAB_URL, WARA_V2_TURN_API_KEY en entorno.
 */
import { randomUUID } from "node:crypto";

const BASE = (process.env.WARA_V2_LAB_URL ?? "https://wara-v2.wd75db.easypanel.host").replace(/\/+$/, "");
const KEY = process.env.WARA_V2_TURN_API_KEY?.trim() ?? "";
const PHONE = process.env.WARA_V2_LAB_PHONE ?? "+5491133788190";
const COMPANY_PICK = process.env.WARA_V2_LAB_COMPANY ?? "2";
const UNIT_PICK = process.env.WARA_V2_LAB_UNIT ?? "1";

if (!KEY) {
  console.error("Falta WARA_V2_TURN_API_KEY en entorno.");
  process.exit(1);
}

const transcript = [];

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function reset() {
  return api("POST", "/api/pilot/reset", { phone: PHONE });
}

async function turn(text, messageId = randomUUID()) {
  const { status, json } = await api("POST", "/api/whatsapp/turn", {
    from: PHONE,
    body: text,
    messageId,
  });
  const line = { user: text, bot: json.message ?? "", status, engine: json.engine, skip: json.skipResponse_s };
  transcript.push(line);
  console.log(`\n→ ${text}`);
  console.log(`← [${status}] ${(json.message ?? JSON.stringify(json)).slice(0, 600)}`);
  return json;
}

async function getState() {
  const q = new URLSearchParams({ phone: PHONE });
  return api("GET", `/api/pilot/state?${q}`);
}

async function pickCompanyAndUnit() {
  await turn("listas de unidades");
  await turn(COMPANY_PICK);
  await turn("listas de unidades");
  await turn(UNIT_PICK);
}

console.log(`Lab: ${BASE} | phone: ${PHONE} | empresa: ${COMPANY_PICK} | unidad: ${UNIT_PICK}`);

console.log("\n=== Health ===");
const health = await fetch(`${BASE}/health`).then((r) => r.json());
console.log(JSON.stringify(health, null, 2));

console.log("\n=== Reset inicial ===");
console.log(await reset());

async function flowOdometerComplete() {
  console.log("\n=== Flujo odómetro completo ===");
  await reset();
  await pickCompanyAndUnit();
  await turn("odometro");
  await turn("130500 km");
  await turn("06/08/2026 15:50");
  await turn("CONFIRMO");
}

async function flowHorometroComplete() {
  console.log("\n=== Flujo horómetro completo ===");
  await reset();
  await pickCompanyAndUnit();
  await turn("horometro");
  await turn("4600 hs");
  await turn("06/08/2026 16:00");
  await turn("CONFIRMO");
}

async function flowOdometerGpsResumeCorrect() {
  console.log("\n=== Odómetro → GPS → reanudar → corregir → confirmar ===");
  await reset();
  await pickCompanyAndUnit();
  await turn("odometro");
  await turn("130500 km");
  await turn("06/08/2026 15:50");
  await turn("donde esta el vehiculo?");
  await turn("continuamos");
  await turn("131000 km");
  await turn("CONFIRMO");
}

async function flowPersistenceProbe() {
  console.log("\n=== Persistencia (estado mid-flow) ===");
  await reset();
  await pickCompanyAndUnit();
  await turn("odometro");
  await turn("130500 km");
  const st = await getState();
  console.log(JSON.stringify(st.json, null, 2));
}

await flowOdometerComplete();
await flowHorometroComplete();
await flowOdometerGpsResumeCorrect();
await flowPersistenceProbe();

console.log("\n=== Estado final ===");
console.log(JSON.stringify((await getState()).json, null, 2));

console.log("\n=== Transcript JSON (sanitized) ===");
console.log(JSON.stringify(transcript, null, 2));
