#!/usr/bin/env node
/**
 * Smoke E2E — flujo exacto del cliente (captura 24-jul-2026):
 * listado de reporte → "no me reporta la AF061DO" → debe ir a unidades/GPS, NO odómetro.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvFile(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(".env.production.local");
loadEnvFile(".env.local");

const phone = process.argv.find((a) => a.startsWith("--phone="))?.split("=", 2)[1]?.trim() ?? "5492612478856";
const base = process.env.WARA_TURN_BASE_URL?.trim() || "https://wara.nivel41.com";
const apiKey = process.env.PULZE_API_KEY?.trim() || process.env.BUILDERBOT_CONTEXT_API_KEY?.trim();

let failed = 0;
function assert(cond, label) {
  if (!cond) {
    failed++;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

async function turn(body, label) {
  const res = await fetch(`${base}/api/whatsapp/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ from: phone, body, api_key: apiKey }),
  });
  const data = await res.json().catch(() => ({}));
  const msg = String(data.message ?? data.summaryText ?? "").trim();
  const executor = data.executor_s ?? data.executor ?? "?";
  console.log(`\n→ ${label}`);
  console.log(`  HTTP ${res.status} | executor=${executor}`);
  console.log(`  ${msg ? msg.slice(0, 320) + (msg.length > 320 ? "…" : "") : "(vacío)"}`);
  return { res, data, msg, executor };
}

async function main() {
  console.log("=".repeat(58));
  console.log("SMOKE PROD — flujo reporte AF061DO (cliente Emii)");
  console.log(`Base: ${base} | Tel: …${phone.slice(-4)}`);
  console.log("=".repeat(58));

  if (!apiKey) {
    console.error("✗ Falta API key");
    process.exit(1);
  }

  await turn("Reiniciar empresa", "Limpieza");
  await turn("2", "El Cacique");

  // Contaminar hilo con horómetro (como sesión real del cliente)
  const horo = await turn("Quiero realizar un ajuste de horometro", "Contaminar con horómetro");
  assert(/patente|hor[oó]metro|matr[ií]cula/i.test(horo.msg), "horómetro pide patente (contaminación)");

  const list = await turn(
    "Quiero consultar por el estado de reporte de mis unidades ¿Me brindas el listado?",
    "Pedir listado reporte",
  );
  assert(list.executor === "unidades", `listado → unidades (obtuvo ${list.executor})`);
  assert(/unidades|414|ejemplos|matr[ií]cula/i.test(list.msg), "responde con flota o pide unidad");

  const report = await turn("no me reporta la AF061DO", "Falta reporte AF061DO");
  assert(report.executor === "unidades", `AF061DO → unidades (obtuvo ${report.executor})`);
  assert(!/Seguimos con el cambio de od[oó]metro/i.test(report.msg), "NO redirige a odómetro");
  assert(
    /reporte|gps|ignici[oó]n|offline|falta|359\d+|caso|AF\s*061\s*DO|AF061DO|M600/i.test(report.msg),
    "responde estado GPS/reporte o ticket",
  );

  console.log("\n" + "=".repeat(58));
  if (failed > 0) {
    console.error(`✗ ${failed} fallo(s) — el cliente tiene razón en prod`);
    process.exit(1);
  }
  console.log("✓ Flujo reporte AF061DO OK en producción");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
