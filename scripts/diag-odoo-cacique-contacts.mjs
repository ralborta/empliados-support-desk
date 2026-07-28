#!/usr/bin/env node
/**
 * Diagnóstico puntual: el cliente reporta que Odoo está "generando contactos" bajo
 * El Cacique S.A. (misma persona/teléfono repetida muchas veces). Este script consulta
 * Odoo en vivo (usando las credenciales de .env.production.local) para:
 *   1) Listar TODOS los res.partner con nombre parecido a "cacique".
 *   2) Listar TODOS los res.partner con ese teléfono/celular (variantes de formato).
 *   3) Mostrar quién y cuándo los creó (create_uid, create_date, parent_id).
 *
 * Uso: node --env-file=.env.production.local scripts/diag-odoo-cacique-contacts.mjs
 *      (o node -r dotenv/config si no hay --env-file en esta versión de node)
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

loadEnvFile(path.join(process.cwd(), ".env.production.local"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const url = (process.env.ODOO_URL ?? "").replace(/\/+$/, "");
const db = process.env.ODOO_DB ?? "";
const email = process.env.ODOO_EMAIL ?? "";
const apiKey = process.env.ODOO_API_KEY ?? "";

if (!url || !db || !email || !apiKey) {
  console.error("Faltan credenciales de Odoo (ODOO_URL/ODOO_DB/ODOO_EMAIL/ODOO_API_KEY). Abortando.");
  process.exit(1);
}

async function jsonRpc(service, method, args) {
  const res = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args } }),
  });
  const body = await res.json();
  if (body.error) {
    throw new Error(body.error.data?.message || body.error.message || "Error Odoo");
  }
  return body.result;
}

const uid = await jsonRpc("common", "authenticate", [db, email, apiKey, {}]);
if (!uid) {
  console.error("No se pudo autenticar contra Odoo.");
  process.exit(1);
}
console.log(`Autenticado OK (uid=${uid}) contra ${url} / db=${db}\n`);

async function execKw(model, method, args, kwargs = {}) {
  return jsonRpc("object", "execute_kw", [db, uid, apiKey, model, method, args, kwargs]);
}

console.log("— res.partner con nombre parecido a 'cacique' —");
const byName = await execKw(
  "res.partner",
  "search_read",
  [[["name", "ilike", "cacique"]]],
  { fields: ["id", "name", "phone", "mobile", "parent_id", "is_company", "create_date", "create_uid"], limit: 200, order: "create_date asc" },
);
console.log(`Total: ${byName.length}`);
for (const p of byName) {
  console.log(
    `  #${p.id} name="${p.name}" phone=${p.phone ?? "-"} mobile=${p.mobile ?? "-"} is_company=${p.is_company} parent_id=${p.parent_id ? p.parent_id[1] : "-"} created=${p.create_date} by=${p.create_uid ? p.create_uid[1] : "-"}`,
  );
}

const PHONE = process.argv[2] || "5492613798934";
console.log(`\n— res.partner con teléfono/celular parecido a '${PHONE}' —`);
const byPhone = await execKw(
  "res.partner",
  "search_read",
  [["|", ["phone", "ilike", PHONE], ["mobile", "ilike", PHONE]]],
  { fields: ["id", "name", "phone", "mobile", "parent_id", "is_company", "create_date", "create_uid"], limit: 200, order: "create_date asc" },
);
console.log(`Total: ${byPhone.length}`);
for (const p of byPhone) {
  console.log(
    `  #${p.id} name="${p.name}" phone=${p.phone ?? "-"} mobile=${p.mobile ?? "-"} is_company=${p.is_company} parent_id=${p.parent_id ? p.parent_id[1] : "-"} created=${p.create_date} by=${p.create_uid ? p.create_uid[1] : "-"}`,
  );
}
