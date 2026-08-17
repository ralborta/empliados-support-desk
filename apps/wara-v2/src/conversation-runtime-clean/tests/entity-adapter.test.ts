import assert from "node:assert/strict";
import test from "node:test";
import { LegacyEntityDirectoryAdapter } from "../adapters/legacy/entity-directory-adapter.js";
import type { ResolutionRequest } from "../core/types/decision.js";
import type { EntityReference } from "../core/types/interpretation.js";
import { createEmptyCleanState } from "../core/types/state.js";

const companies = [
  { id: "co-a", name: "Transportes Norte" }, { id: "co-b", name: "Transportes Sur" }, { id: "co-c", name: "Logística Central" },
];
const units = [
  { id: "u-1", label: "Camión Alfa", code: "M900-088", plate: "AA900088", companyId: "co-a" },
  { id: "u-2", label: "Camión Beta", code: "M300-097", plate: "AB300097", companyId: "co-a" },
  { id: "u-3", label: "Camión Gamma", code: "M700-011", plate: "AC700011", companyId: "co-a" },
];
const adapter = new LegacyEntityDirectoryAdapter({ companies, units });

function request(entityType: "company" | "unit", reference: EntityReference): ResolutionRequest {
  return { id: "r", entityType, reference, scope: { tenantId: "t", companyId: "co-a" } };
}
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
