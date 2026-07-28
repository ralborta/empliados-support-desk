#!/usr/bin/env node
/**
 * Diagnóstico puntual: el cliente reportó que "M600-085" no resuelve en el trámite de
 * odómetro aunque la unidad existe (patente PJN839, cliente El Cacique). Este script
 * repite la cadena real (ObtenerContactosPorNumero -> CreateChatBotToken ->
 * ConsultarEstadoUnidades) contra Wara en vivo, usando las credenciales de
 * .env.production.local, para ver el campo `unidad` CRUDO tal cual lo devuelve la API.
 *
 * Uso: node scripts/diag-wara-m600085.mjs [telefono]
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile(path.join(process.cwd(), process.env.WARA_DIAG_ENV_FILE || ".env.production.local"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const token = process.env.WARA_OBTENER_EMPRESA_TOKEN?.trim() || "";
const base = (process.env.WARA_API_BASE_URL?.trim() || "https://apps.visionblo.com/rb/app/api_interna").replace(/\/+$/, "");
const phone = process.argv[2] || "5492612478856";

async function call(pathName, payload, bearer) {
  const res = await fetch(`${base}/${pathName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

console.log(`Base: ${base}\nTeléfono: ${phone}\n`);

const r1 = await call("ObtenerContactosPorNumero", { token, telefono: phone });
const j1 = r1.json ?? {};
const contactos = Array.isArray(j1.contactos) ? j1.contactos : [];
console.log(`ObtenerContactosPorNumero: status=${r1.status} contactos=${contactos.length} raw=${JSON.stringify(j1)}`);
for (const c of contactos) console.log(`  - id=${c.contacto_id ?? c.id} empresa=${c.empresa ?? c.nombre}`);

const first = contactos.find((c) => /cacique/i.test(c.empresa ?? c.nombre ?? "")) || contactos[0];
const contactId = first ? (first.contacto_id ?? first.id) : null;
let sessionToken = typeof j1.SessionToken === "string" ? j1.SessionToken : undefined;
if (!sessionToken && contactId != null) {
  const r2 = await call("CreateChatBotToken", { token, contacto_id: contactId });
  const j2 = r2.json ?? {};
  sessionToken = j2.SessionToken || j2.sessionToken;
  console.log(`CreateChatBotToken: status=${r2.status} hasSession=${!!sessionToken} customer=${j2.CustomerName ?? j2.customerName ?? "-"}`);
}

if (!sessionToken) {
  console.error("No se obtuvo sessionToken. Abortando.");
  process.exit(1);
}

const r3 = await call("ConsultarEstadoUnidades", { token: sessionToken, patentes: [] }, sessionToken);
const j3 = r3.json ?? {};
const d3 = j3.data && typeof j3.data === "object" ? j3.data : j3;
const unidades = Array.isArray(d3.unidades) ? d3.unidades : [];
console.log(`\nConsultarEstadoUnidades: status=${r3.status} cliente=${d3.cliente ?? "-"} total unidades=${unidades.length}\n`);

console.log("— Buscando M600-085 / PJN839 / 006-085 —");
const needle = /085|PJN/i;
const candidates = unidades.filter((u) => needle.test(JSON.stringify(u)));
for (const u of candidates) {
  console.log(JSON.stringify(u, null, 2));
}
if (candidates.length === 0) {
  console.log("(sin coincidencias — mostrando las primeras 5 unidades crudas para ver el formato del campo)");
  for (const u of unidades.slice(0, 5)) console.log(JSON.stringify(u));
}

console.log("\n— Repro real con resolveUnitQuery contra la flota completa —");
const { resolveUnitQuery, filterUnitsByUnitName } = await import("../src/lib/waraUnitIntent.ts");
const looseHits = filterUnitsByUnitName(unidades, "M600-085");
console.log(`filterUnitsByUnitName("M600-085") → ${looseHits.length} match(es):`, looseHits.map((u) => `${u.unidad} / ${u.patente}`));

const rawText = "la unidad es la M600-085. Indicame como es un cambio de odometro";
const result = await resolveUnitQuery({
  rawText,
  threadText: "Bot: ¿Podrías especificar la matrícula o nombre exacto de la unidad?",
  units: unidades,
  preferAi: true,
  odometerContext: true,
});
console.log("resolveUnitQuery(...) =>", JSON.stringify(result, null, 2));
