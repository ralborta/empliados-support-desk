import assert from "node:assert/strict";
import test from "node:test";
import { LegacyEntityDirectoryAdapter } from "../adapters/legacy/entity-directory-adapter.js";
import { WaraEntityResolver } from "../adapters/services/wara-entity-resolver.js";
import { GuardedWaraAdapter } from "../adapters/services/guarded-wara-adapter.js";
import { GuardedHttpTransport } from "../adapters/services/guarded-http-transport.js";
import { loadCleanRuntimeConfig } from "../config/clean-config.js";
import type { ResolutionRequest } from "../core/types/decision.js";
import type { EntityReference } from "../core/types/interpretation.js";
import { createEmptyCleanState } from "../core/types/state.js";

const companies = [
  { id: "co-a", name: "Transportes Norte" }, { id: "co-b", name: "Transportes Sur" }, { id: "co-c", name: "Logística Central" },
];
const units = [
  { id: "u-1", label: "Camión Alfa", code: "M900-088", plate: "AA900088", brand: "Iveco", model: "Tector 170E", companyId: "co-a" },
  { id: "u-2", label: "Camión Beta", code: "M300-097", plate: "AB300097", brand: "Scania", model: "R450", companyId: "co-a" },
  { id: "u-3", label: "Camión Gamma", code: "M700-011", plate: "AC700011", brand: "Iveco", model: "Daily", companyId: "co-a" },
];
const adapter = new LegacyEntityDirectoryAdapter({ companies, units });

function request(entityType: "company" | "unit", reference: EntityReference): ResolutionRequest {
  return { id: "r", entityType, reference, scope: { tenantId: "t", companyId: "co-a" } };
}
test("unit search keeps numeric internal codes distinct from plates and supports brand/model", async () => {
  const code = await resolve("unit", { type: "unit", expression: "900088", source: "message", unitReferenceKind: "internal_code" });
  assert.equal(code.status === "resolved" && code.entity.entityType === "unit" && code.entity.unit.id, "u-1");
  const plate = await resolve("unit", { type: "unit", expression: "AA900088", source: "message", unitReferenceKind: "plate" });
  assert.equal(plate.status === "resolved" && plate.entity.entityType === "unit" && plate.entity.unit.id, "u-1");
  assert.equal((await resolve("unit", { type: "unit", expression: "Iveco", source: "message", unitReferenceKind: "brand" })).status, "ambiguous");
  const model = await resolve("unit", { type: "unit", expression: "R450", source: "message", unitReferenceKind: "model" });
  assert.equal(model.status === "resolved" && model.entity.entityType === "unit" && model.entity.unit.id, "u-2");
});
async function resolve(entityType: "company" | "unit", reference: EntityReference, statePatch = {}) {
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), ...statePatch };
  return (await adapter.resolve([request(entityType, reference)], state))[0]!;
}

for (const expression of ["900088", "M900088", "M900-088", "AA900088"]) {
  test(`unit normalization resolves ${expression}`, async () => {
    const result = await resolve("unit", { type: "unit", expression, source: "explicit" });
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") assert.equal(result.entity.entityType === "unit" && result.entity.unit.id, "u-1");
  });
}
test("unit resolves listing index 2", async () => {
  const result = await resolve("unit", { type: "listing_index", expression: "2", source: "last_presented", index: 2 }, {
    lastListing: { kind: "unit" as const, createdAt: "x", items: units.map((unit, index) => ({ index: index + 1, entityType: "unit" as const, id: unit.id, label: unit.label })) },
  });
  assert.equal(result.status === "resolved" && result.entity.entityType === "unit" && result.entity.unit.id, "u-2");
});
test("unit resolves active and previous only from structured source", async () => {
  const state = { unit: units[0], previousUnit: units[1] };
  const active = await resolve("unit", { type: "unit", expression: "", source: "active" }, state);
  const previous = await resolve("unit", { type: "unit", expression: "", source: "previous" }, state);
  assert.equal(active.status === "resolved" && active.entity.entityType === "unit" && active.entity.unit.id, "u-1");
  assert.equal(previous.status === "resolved" && previous.entity.entityType === "unit" && previous.entity.unit.id, "u-2");
});
test("previous unit without structured context is not invented", async () => {
  const result = await resolve("unit", { type: "unit", expression: "", source: "previous" });
  assert.equal(result.status, "not_found");
  assert.equal("entity" in result, false);
});
test("unit distinguishes not_found and ambiguous", async () => {
  assert.equal((await resolve("unit", { type: "unit", expression: "ZZ999999", source: "explicit" })).status, "not_found");
  assert.equal((await resolve("unit", { type: "unit", expression: "Camión", source: "explicit" })).status, "ambiguous");
});
test("company resolves valid listing index and rejects out of range", async () => {
  const listing = { lastListing: { kind: "company" as const, createdAt: "x", items: companies.map((company, index) => ({ index: index + 1, entityType: "company" as const, id: company.id, label: company.name })) } };
  assert.equal((await resolve("company", { type: "listing_index", expression: "2", source: "last_presented", index: 2 }, listing)).status, "resolved");
  assert.equal((await resolve("company", { type: "listing_index", expression: "9", source: "last_presented", index: 9 }, listing)).status, "not_found");
});
test("company resolves exact, ambiguous and active", async () => {
  assert.equal((await resolve("company", { type: "company", expression: "Logistica Central", source: "explicit" })).status, "resolved");
  assert.equal((await resolve("company", { type: "company", expression: "Transportes", source: "explicit" })).status, "ambiguous");
  const active = await resolve("company", { type: "company", expression: "", source: "active" }, { company: companies[0] });
  assert.equal(active.status === "resolved" && active.entity.entityType === "company" && active.entity.company.id, "co-a");
});

test("real WARA resolver normalizes verified fleet fields before matching a numeric code, brand or model", async () => {
  const observedBodies: unknown[] = [];
  const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true" });
  const wara = new GuardedWaraAdapter(new GuardedHttpTransport(config, async (input) => {
    observedBodies.push(input.body);
    return { ok: true, data: { unidades: [
      { movil_id: 900115, unidad: "M900-115", patente: "AD427MC", marca: "Iveco", modelo: "Tector" },
      { movil_id: 900110, unidad: "M900-110", patente: "AF110ZZ", marca: "Iveco", modelo: "Daily" },
    ] } };
  }));
  const resolver = new WaraEntityResolver(wara, new Set(["t"]));
  const state = { ...createEmptyCleanState({ tenantId: "t", conversationId: "c" }), company: { id: "co-a", name: "Company" } };
  const code = await resolver.resolve([request("unit", { type: "unit", expression: "900115", source: "message", unitReferenceKind: "internal_code" })], state);
  assert.equal(code[0]?.status === "resolved" && code[0].entity.entityType === "unit" && code[0].entity.unit.id, "900115");
  const brand = await resolver.resolve([request("unit", { type: "unit", expression: "Iveco", source: "message", unitReferenceKind: "brand" })], state);
  assert.equal(brand[0]?.status, "ambiguous");
  const model = await resolver.resolve([request("unit", { type: "unit", expression: "Daily", source: "message", unitReferenceKind: "model" })], state);
  assert.equal(model[0]?.status === "resolved" && model[0].entity.entityType === "unit" && model[0].entity.unit.id, "900110");
  assert.equal((observedBodies[0] as { referenceKind?: string }).referenceKind, "internal_code");
});

test("real WARA resolver selects a typed company reference from a multi-company phone", async () => {
  const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true" });
  const wara = new GuardedWaraAdapter(new GuardedHttpTransport(config, async () => ({ ok: true, data: { companies: [{ id: 1, name: "Transporte Norte" }, { id: 2, name: "Logística Sur" }] } })));
  const resolver = new WaraEntityResolver(wara, new Set(["t"]));
  const result = await resolver.resolve([request("company", { type: "company", expression: "logistica sur", source: "message" })], createEmptyCleanState({ tenantId: "t", conversationId: "c" }));
  assert.equal(result[0]?.status === "resolved" && result[0].entity.entityType === "company" && result[0].entity.company.id, "2");
});

test("real WARA resolver applies a company resolution before resolving the dependent unit", async () => {
  const observedCompanyIds: unknown[] = [];
  const config = loadCleanRuntimeConfig({ WARA_CLEAN_RUNTIME_ENABLED: "true", WARA_CLEAN_EXTERNAL_READS_ENABLED: "true" });
  const wara = new GuardedWaraAdapter(new GuardedHttpTransport(config, async (input) => {
    const body = input.body as Record<string, unknown>;
    if (input.path === "/ObtenerContactosPorNumero") return { ok: true, data: { companies: [{ id: "131776", name: "El Cacique S.A." }] } };
    observedCompanyIds.push(body.companyId);
    return { ok: true, data: { unidades: [{ movil_id: 334, unidad: "900113", patente: "AA000AA" }] } };
  }));
  const resolver = new WaraEntityResolver(wara, new Set(["t"]));
  const results = await resolver.resolve([
    { id: "company-resolution", entityType: "company", reference: { type: "company", expression: "El Cacique", source: "message" }, scope: { tenantId: "t" } },
    { id: "unit-resolution", entityType: "unit", reference: { type: "unit", expression: "900113", source: "message", unitReferenceKind: "internal_code" }, scope: { tenantId: "t" } },
  ], createEmptyCleanState({ tenantId: "t", conversationId: "c" }));
  assert.deepEqual(results.map((result) => result.status), ["resolved", "resolved"]);
  assert.deepEqual(observedCompanyIds, ["131776"]);
  assert.match(results.flatMap((result) => "facts" in result ? result.facts : []).map((item) => item.text).join(" "), /Empresa El Cacique S\.A\. seleccionada/);
});
