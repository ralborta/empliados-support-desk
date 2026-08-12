#!/usr/bin/env node
/**
 * Canary hotfix V1 — conversaciones dirigidas contra base URL (preview o local).
 * Requiere: PULZE_API_KEY, WARA_TURN_BASE_URL apuntando al deploy candidato con
 * WARA_V1_HOTFIX_CANARY_ENABLED=true y ALLOWLIST=+5491133788190
 */
const BASE = (process.env.WARA_TURN_BASE_URL ?? "").trim().replace(/\/+$/, "");
const API_KEY =
  process.env.PULZE_API_KEY?.trim() ||
  process.env.BUILDERBOT_CONTEXT_API_KEY?.trim() ||
  "";
const PHONE = process.env.WARA_CANARY_PHONE?.trim() || "+5491133788190";

if (!BASE || !API_KEY) {
  console.error("Indicá WARA_TURN_BASE_URL y PULZE_API_KEY");
  process.exit(2);
}

const TURN = `${BASE}/api/whatsapp/turn`;
const ODO = `${BASE}/api/wara/odometro-horometro`;

const log = [];
function record(step, data) {
  const row = { ts: new Date().toISOString(), step, ...data };
  log.push(row);
  console.log(JSON.stringify(row));
}

async function turn(body, messageId) {
  const res = await fetch(TURN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      ...(messageId ? { "x-message-id": messageId } : {}),
    },
    body: JSON.stringify({ from: PHONE, body, messageId }),
  });
  const headers = {
    canary: res.headers.get("x-wara-v1-canary"),
    sha: res.headers.get("x-wara-v1-hotfix-sha"),
    proxied: res.headers.get("x-wara-v1-canary-fallback"),
  };
  const json = await res.json().catch(() => ({}));
  return { status: res.status, headers, json };
}

async function odo(body, messageId) {
  const res = await fetch(ODO, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      ...(messageId ? { "x-message-id": messageId } : {}),
    },
    body: JSON.stringify({ from: PHONE, rawText: body, messageId }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  record("start", { base: BASE, phone: PHONE });

  // Aislamiento: número externo debe proxy (si se prueba contra candidato con canary ON)
  const ext = await turn("hola", "probe-ext-1");
  if (process.env.WARA_V1_HOTFIX_CANARY_ENABLED === "true") {
    record("isolation_external", {
      expect: "proxy_or_prod",
      canary: ext.headers.canary,
      proxied: ext.headers.proxied,
    });
  }

  let r = await turn("quiero cargar odometro", "odo-1");
  record("odometro_start", { message: r.json.message?.slice(0, 120), canary: r.headers.canary });

  r = await turn("que es el odometro?", "side-1");
  record("consulta_lateral", { message: r.json.message?.slice(0, 120) });

  r = await turn("continuamos", "resume-1");
  record("retomar_tras_lateral", { message: r.json.message?.slice(0, 120) });

  r = await turn("cancelar trámite", "cancel-1");
  record("cancelar", { message: r.json.message?.slice(0, 80) });

  r = await turn("cambiar de unidad", "change-unit-1");
  record("cambio_unidad", { message: r.json.message?.slice(0, 120) });

  // Idempotencia vía endpoint odómetro (messageId A, reenvío A, CONFIRMO B)
  const confA = "conf-msg-A-canary";
  const confB = "conf-msg-B-canary";
  let o = await odo("CONFIRMO", confA);
  record("confirmo_A", { duplicateBlocked: o.json.duplicateBlocked, ok: o.json.ok });
  o = await odo("CONFIRMO", confA);
  record("reenvio_A", { duplicateBlocked: o.json.duplicateBlocked, message: o.json.message?.slice(0, 80) });
  o = await odo("CONFIRMO", confB);
  record("confirmo_B_misma_op", { duplicateBlocked: o.json.duplicateBlocked, message: o.json.message?.slice(0, 80) });

  r = await turn("Hola", "stale-greet-1");
  record("saludo", { message: r.json.message?.slice(0, 80) });

  const outPath = process.env.WARA_CANARY_LOG ?? ".local-data/v1-hotfix-canary-log.json";
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(log, null, 2));
  console.log(`\nLog: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
