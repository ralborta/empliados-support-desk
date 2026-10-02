import assert from "node:assert/strict";
import { it } from "node:test";
import { WaraApiSessionTransport } from "../adapters/http/wara-api-session-transport.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

it("uses the native WARA phone -> company -> session -> fleet protocol", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown>; authorization: string | null }> = [];
  const client = new WaraApiSessionTransport({ baseUrl: "https://wara.test", maintenanceBaseUrl: "https://maintenance.test", rootToken: "root-secret", phone: "+54 9 11 3378-8190", retryDelaysMs: [] }, async (url, init) => {
    const path = new URL(url).pathname; const body = JSON.parse(String(init.body)) as Record<string, unknown>; const headers = new Headers(init.headers);
    calls.push({ path, body, authorization: headers.get("authorization") });
    if (path === "/ObtenerContactosPorNumero") return json({ contacto: { contacto_id: 64866, empresa: "WARA" }, SessionToken: "session-secret", CustomerName: "Raúl" });
    if (path === "/ConsultarEstadoUnidades") return json({ ok: true, data: { unidades: [{ movil_id: 900113, unidad: "900113", patente: "AD427MC" }] } });
    return json({}, 404);
  });
  const companies = await client.transport({ path: "/ObtenerContactosPorNumero", body: {}, correlationId: "c1", tenantId: "t", timeoutMs: 1000 });
  assert.deepEqual(companies, { ok: true, data: { companies: [{ id: "64866", name: "WARA" }] } });
  const fleet = await client.transport({ path: "/ConsultarEstadoUnidades", body: { companyId: "64866", patentes: [] }, correlationId: "c2", tenantId: "t", timeoutMs: 1000 }) as { data: { unidades: Array<Record<string, unknown>> } };
  assert.equal(fleet.data.unidades[0]?.companyId, "64866");
  assert.deepEqual(calls.map((call) => call.path), ["/ObtenerContactosPorNumero", "/ConsultarEstadoUnidades"]);
  assert.deepEqual(calls[0]?.body, { token: "root-secret", telefono: "5491133788190" });
  assert.equal(calls[1]?.authorization, "Bearer session-secret");
  assert.deepEqual(calls[1]?.body, { token: "session-secret", patentes: [] });
});

it("requires an explicit company when the phone belongs to more than one", async () => {
  const paths: string[] = [];
  const client = new WaraApiSessionTransport({ baseUrl: "https://wara.test", maintenanceBaseUrl: "https://wara.test", rootToken: "root", phone: "5491112345678", retryDelaysMs: [] }, async (url, init) => {
    const path = new URL(url).pathname; paths.push(path);
    if (path === "/ObtenerContactosPorNumero") return json({ contactos: [{ id: 1, empresa: "A" }, { id: 2, empresa: "B" }] });
    if (path === "/CreateChatBotToken") { assert.equal((JSON.parse(String(init.body)) as { contacto_id: number }).contacto_id, 2); return json({ data: { SessionToken: "selected-token" } }); }
    if (path === "/ConsultarEstadoUnidades") return json({ data: { unidades: [] } });
    return json({}, 404);
  });
  const missing = await client.transport({ path: "/ConsultarEstadoUnidades", body: { patentes: [] }, correlationId: "c", tenantId: "t", timeoutMs: 1000 });
  assert.deepEqual(missing, { status: "validation_error", errors: ["company_selection_required"] });
  await client.transport({ path: "/ConsultarEstadoUnidades", body: { companyId: "2", patentes: [] }, correlationId: "c", tenantId: "t", timeoutMs: 1000 });
  assert.deepEqual(paths, ["/ObtenerContactosPorNumero", "/CreateChatBotToken", "/ConsultarEstadoUnidades"]);
});

it("rejects missing channel identity without calling WARA", async () => {
  let calls = 0;
  const client = new WaraApiSessionTransport({ baseUrl: "https://wara.test", maintenanceBaseUrl: "https://wara.test", rootToken: "root", phone: null, retryDelaysMs: [] }, async () => { calls++; return json({}); });
  assert.deepEqual(await client.transport({ path: "/ObtenerContactosPorNumero", body: {}, correlationId: "c", tenantId: "t", timeoutMs: 1000 }), { status: "validation_error", errors: ["phone_invalid"] });
  assert.equal(calls, 0);
});
