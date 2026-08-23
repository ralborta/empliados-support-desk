#!/usr/bin/env node
/**
 * Smoke test E2E contra producción (POST /api/whatsapp/turn).
 * Cubre los escenarios críticos de entrega jul-2026.
 *
 * Uso:
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/smoke-delivery-prod.mjs --phone=5492612478856
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

const args = process.argv.slice(2);
const phoneArg = args.find((a) => a.startsWith("--phone="));
const phone = phoneArg?.split("=", 2)[1]?.trim() ?? process.env.TEST_WA_PHONE?.trim() ?? "5491133788190";
const base = process.env.WARA_TURN_BASE_URL?.trim() || "https://wara.nivel41.com";
const apiKey =
  process.env.PULZE_API_KEY?.trim() || process.env.BUILDERBOT_CONTEXT_API_KEY?.trim();

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
  const skip = data.skipResponse_s === "true";
  const executor = data.executor_s ?? data.executor ?? "?";
  console.log(`\n→ ${label}`);
  console.log(`  HTTP ${res.status} | executor=${executor} | skip=${skip}`);
  console.log(`  ${msg ? msg.slice(0, 280) + (msg.length > 280 ? "…" : "") : "(vacío)"}`);
  return { res, data, msg, skip, executor };
}

async function diagChain() {
  const res = await fetch(`${base}/api/wara/diag?phone=${encodeURIComponent(phone)}&chain=1`, {
    headers: { "x-api-key": apiKey },
  });
  const data = await res.json().catch(() => ({}));
  const obtener = data.chain?.obtener?.status ?? data.chain?.lookup?.status ?? "?";
  const session = data.chain?.session?.status ?? data.chain?.createToken?.status ?? "?";
  console.log(`\n— Wara diag (chain) —`);
  console.log(`  HTTP ${res.status} | lookup/obtener=${obtener} | session=${session}`);
  assert(res.status === 200, "diag responde 200");
  assert(String(obtener) === "200" || data.ok === true, "Wara lookup accesible");
  return data;
}

async function main() {
  console.log("=".repeat(56));
  console.log("SMOKE PROD — entrega crítica jul-2026");
  console.log(`Base: ${base}`);
  console.log(`Teléfono: ${phone.slice(0, 4)}…${phone.slice(-4)}`);
  console.log("=".repeat(56));

  if (!apiKey) {
    console.error("\n✗ Falta PULZE_API_KEY o BUILDERBOT_CONTEXT_API_KEY (.env.production.local)");
    process.exit(1);
  }

  await diagChain();

  console.log("\n— Limpieza de sesión —");
  await turn("Reiniciar empresa", "Limpieza inicial");
  await turn("2", "El Cacique post-limpieza");

  console.log("\n— Flujo A: ajuste horómetro en blanco —");
  const horo = await turn("Quiero realizar un ajuste de horometro", "Arranque horómetro");
  assert(
    /patente|matr[ií]cula|marca|nombre|hor[oó]metro en horas/i.test(horo.msg),
    "pide patente/unidad u horas (según contexto)",
  );
  assert(!/Perfecto, tomo AD 427 MC/i.test(horo.msg), "no reutiliza AD 427 MC sin pedirlo");

  console.log("\n— Flujo B: búsqueda por nombre de unidad —");
  await turn("Reiniciar empresa", "Reset para flujo B");
  await turn("2", "El Cacique");
  const find = await turn("Ayudame a encontrar mi unidad", "Pedir ayuda unidad");
  assert(find.msg.length > 10 && !find.skip, "responde al pedir unidad");

  const unit = await turn("300-112", "Nombre unidad 300-112");
  assert(
    unit.executor === "unidades" || unit.executor === "certificados",
    `300-112 va a unidades/certificados (obtuvo ${unit.executor})`,
  );
  assert(!/empiece con SI|ESLA600117/i.test(unit.msg), "no confunde con prefijo SI ni ESLA600117");
  assert(!unit.skip || unit.msg.length > 10, "300-112 no queda mudo");

  console.log("\n— Flujo C: certificado + confirmación breve —");
  await turn("Reiniciar empresa", "Reset para flujo C");
  await turn("2", "El Cacique");
  await turn("Necesito un certificado de cobertura", "Pedir certificado");
  const certUnit = await turn("300-112", "Unidad para certificado");
  assert(certUnit.executor === "certificados", `certificado + 300-112 → certificados (obtuvo ${certUnit.executor})`);
  assert(certUnit.msg.length > 10, "resuelve o pide unidad para certificado");

  if (/CONFIRMO|confirmo/i.test(certUnit.msg)) {
    const si = await turn("si", "Confirmación con 'si'");
    assert(!/empiece con SI|prefijo.*SI/i.test(si.msg), "'si' no es prefijo SI");
    assert(
      /gener[eé]|envi[eé]|certificado|CONFIRMO|correcto/i.test(si.msg),
      "'si' avanza certificado o pide CONFIRMO",
    );
  }

  console.log("\n" + "=".repeat(56));
  if (failed > 0) {
    console.error(`✗ Smoke prod: ${failed} fallo(s)`);
    process.exit(1);
  }
  console.log("✓ Smoke prod OK — listo para pruebas del cliente");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
