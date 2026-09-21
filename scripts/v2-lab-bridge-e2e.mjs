#!/usr/bin/env node
/**
 * Recorrido E2E lab: conversación V2 → bridge ticket → mesa front-v2-lab.
 * Sin WhatsApp real. Requiere WARA_V2_TURN_API_KEY y WARA_V2_BRIDGE_API_KEY.
 */
import { randomUUID } from "node:crypto";

const V2_BASE = (process.env.WARA_V2_LAB_URL ?? "https://wara-v2.wd75db.easypanel.host").replace(/\/+$/, "");
const FRONT_BASE = (process.env.WARA_V2_FRONT_LAB_URL ?? "https://wara-front-v2-lab.wd75db.easypanel.host").replace(/\/+$/, "");
const TURN_KEY = process.env.WARA_V2_TURN_API_KEY?.trim() ?? "";
const BRIDGE_KEY = process.env.WARA_V2_BRIDGE_API_KEY?.trim() ?? TURN_KEY;
const PHONE = process.env.WARA_V2_LAB_PHONE ?? "+5491133788190";

if (!TURN_KEY) {
  console.error("Falta WARA_V2_TURN_API_KEY");
  process.exit(1);
}

async function v2Post(path, body) {
  const r = await fetch(`${V2_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": TURN_KEY },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function v2Get(path) {
  const r = await fetch(`${V2_BASE}${path}`, { headers: { "x-api-key": TURN_KEY }, cache: "no-store" });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function frontGet(path, cookie) {
  const r = await fetch(`${FRONT_BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
    redirect: "manual",
  });
  return { status: r.status, json: await r.json().catch(() => ({})), headers: r.headers };
}

async function turn(text) {
  const { status, json } = await v2Post("/api/whatsapp/turn", {
    from: PHONE,
    body: text,
    messageId: randomUUID(),
  });
  const msg = String(json.message ?? json.skipResponse ? "(skipResponse)" : "");
  console.log(`→ ${text}`);
  console.log(`← [${status}] ${msg.slice(0, 300)}`);
  return { status, message: msg, json };
}

async function login(email, password) {
  const r = await fetch(`${FRONT_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = r.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, cookie, json };
}

console.log("=== Health v2-shadow ===");
console.log(JSON.stringify((await v2Get("/health")).json, null, 2));

console.log("\n=== Front lab reachability ===");
const loginPage = await fetch(`${FRONT_BASE}/login`);
console.log(`GET /login → ${loginPage.status}`);

console.log("\n=== 1. Reset + ticket derivación V2 ===");
await v2Post("/api/pilot/reset", { phone: PHONE });
await turn("listas de unidades");
await turn("2");
await turn("listas de unidades");
await turn("1");
await turn("necesito hablar con un asesor porque el gps no reporta");
await turn("CONFIRMO");

console.log("\n=== 2. Bridge idempotencia (re-derivación) ===");
const dup = await turn("CONFIRMO");
console.log("dup:", dup.message.slice(0, 120));

console.log("\n=== 3. customer-status botPaused ===");
const q = new URLSearchParams({ phone: PHONE, tenantId: "tenant_internal_ops" });
const cs = await fetch(`${FRONT_BASE}/api/v2/bridge/customer-status?${q}`, {
  headers: { "x-api-key": BRIDGE_KEY },
});
console.log("customer-status:", cs.status, await cs.json().catch(() => ({})));

console.log("\n=== 4. Login mesa lab (SUPPORT) ===");
const supportEmail = process.env.PANEL_USER_WARA_EMAIL ?? "wara@nivel41.com";
const supportPw = process.env.PANEL_USER_WARA_PASSWORD ?? "";
if (supportPw) {
  const sess = await login(supportEmail, supportPw);
  console.log("login SUPPORT:", sess.ok, sess.json?.user?.role);
  if (sess.cookie) {
    const tickets = await frontGet("/api/tickets?limit=5", sess.cookie);
    console.log("tickets count sample:", Array.isArray(tickets.json?.tickets) ? tickets.json.tickets.length : tickets.status);
    const first = tickets.json?.tickets?.[0];
    if (first?.id) {
      const op = await frontGet(`/api/tickets/${first.id}/v2-operation`, sess.cookie);
      console.log("v2-operation:", JSON.stringify(op.json, null, 2));
    }
  }
} else {
  console.log("SKIP login: falta PANEL_USER_WARA_PASSWORD");
}

console.log("\n=== Done ===");
