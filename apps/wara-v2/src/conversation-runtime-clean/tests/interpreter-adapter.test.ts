import assert from "node:assert/strict";
import test from "node:test";
import { StableInterpreterAdapter, type StableInterpreterTransport } from "../adapters/interpreter/stable-interpreter-adapter.js";
import { deepFreezeInterpretationValue, mapStableInterpretation } from "../adapters/interpreter/stable-output-mapper.js";
import { CLEAN_INTERPRETATION_SCHEMA_VERSION, CLEAN_INTERPRETER_ADAPTER_VERSION, CLEAN_INTERPRETER_PROMPT_VERSION } from "../adapters/interpreter/versions.js";
import { CLEAN_INTERPRETER_JSON_SCHEMA, CLEAN_INTERPRETER_SYSTEM_PROMPT, CleanOpenAiInterpreterTransport, cleanInterpreterTemporalDefaults } from "../adapters/interpreter/clean-openai-interpreter-transport.js";
import { createEmptyCleanState } from "../core/types/state.js";

const empty = createEmptyCleanState({ tenantId: "t", conversationId: "c" });
function raw(patch: Record<string, unknown> = {}) {
  return { userAct: "request", relation: "standalone", normalizedMeaning: "structured", requests: [], references: [], corrections: [], answersExpectedField: false, confidence: 0.9, ...patch };
}

test("versions the Clean adapter, schema and prompt", () => {
  assert.match(CLEAN_INTERPRETER_ADAPTER_VERSION, /^clean-/);
  assert.match(CLEAN_INTERPRETATION_SCHEMA_VERSION, /^clean-/);
  assert.match(CLEAN_INTERPRETER_PROMPT_VERSION, /^clean-/);
});
test("invalid JSON and schema errors return null without fallback", () => {
  assert.equal(mapStableInterpretation("{broken", empty), null);
  assert.equal(mapStableInterpretation({ userAct: "request" }, empty), null);
  assert.equal(mapStableInterpretation(raw({ relation: "invented" }), empty), null);
});
test("maps greeting without fabricating requests", () => {
  const result = mapStableInterpretation(raw({ userAct: "greeting", relation: "pause" }), empty);
  assert.equal(result?.userAct, "greeting"); assert.equal(result?.relation, "pause"); assert.deepEqual(result?.intents, []);
});
test("maps multiple registered requests to Clean operation kinds", () => {
  const result = mapStableInterpretation(raw({ requests: [
    { serviceId: "gps.get_status", domain: "gps", goal: "status", entities: {}, operationHint: "read" },
    { serviceId: "certificate.prepare", domain: "certificate", goal: "prepare", entities: {}, operationHint: "write" },
  ] }), empty);
  assert.deepEqual(result?.intents.map((item) => [item.serviceId, item.operationKind]), [["gps.get_status", "read"], ["certificate.prepare", "write_prepare"]]);
});
test("maps lateral and switch relations unchanged", () => {
  assert.equal(mapStableInterpretation(raw({ userAct: "question", relation: "side_question" }), empty)?.relation, "side_question");
  assert.equal(mapStableInterpretation(raw({ relation: "switch" }), empty)?.relation, "switch");
});
test("maps answer_expected only into the typed expected field", () => {
  const state = { ...empty, expectedInput: { field: "unit" as const, taskId: null, purpose: "unit" } };
  const result = mapStableInterpretation(raw({ userAct: "answer", relation: "answer_expected", answersExpectedField: true, expectedFieldValue: "unit-ref" }), state);
  assert.deepEqual(result?.suppliedFields, [{ field: "unit", value: "unit-ref" }]);
});
test("maps multiple normalized temporal fields and typed unit references without reinterpreting them", () => {
  const result = mapStableInterpretation(raw({ userAct: "answer", relation: "answer_expected", answersExpectedField: true,
    suppliedFields: [{ field: "date", value: "2026-08-17" }, { field: "time", value: "18:00" }],
    references: [{ type: "unit", expression: "900115", source: "message", unitReferenceKind: "internal_code" }] }), empty);
  assert.deepEqual(result?.suppliedFields, [{ field: "date", value: "2026-08-17" }, { field: "time", value: "18:00" }]);
  assert.equal(result?.references[0]?.unitReferenceKind, "internal_code");
});
test("rejects malformed temporal fields and unknown unit reference kinds", () => {
  assert.equal(mapStableInterpretation(raw({ suppliedFields: [{ field: "time", value: "25:70" }] }), empty), null);
  assert.equal(mapStableInterpretation(raw({ suppliedFields: [{ field: "date", value: "2026-02-30" }] }), empty), null);
  assert.equal(mapStableInterpretation(raw({ references: [{ type: "unit", expression: "900115", unitReferenceKind: "numeric_plate" }] }), empty), null);
});
test("native Clean prompt declares temporal authority, cancellation and every unit search key", () => {
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /referenceInstant/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /internal_code/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /brand/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /model/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /cancellation/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /Nunca copies una fecha, hora o valor como reference\.type=unit/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /userAct=answer, relation=answer_expected/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /company\.select/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /Nunca vuelvas a emitir company\.list para una selección/);
  assert.match(CLEAN_INTERPRETER_SYSTEM_PROMPT, /Una cantidad no es una confirmación/);
  assert.equal(cleanInterpreterTemporalDefaults.timeZone, "America/Argentina/Buenos_Aires");
});
test("native Clean transport exposes a strict closed schema for every semantic field", () => {
  assert.equal(CLEAN_INTERPRETER_JSON_SCHEMA.type, "object");
  assert.equal(CLEAN_INTERPRETER_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(CLEAN_INTERPRETER_JSON_SCHEMA.required, [
    "userAct", "relation", "normalizedMeaning", "requests", "references", "suppliedFields",
    "corrections", "answersExpectedField", "confidence", "ambiguity", "confirmation",
  ]);
  assert.equal(CLEAN_INTERPRETER_JSON_SCHEMA.properties.requests.items.additionalProperties, false);
  assert.equal(CLEAN_INTERPRETER_JSON_SCHEMA.properties.references.items.additionalProperties, false);
  assert.equal(CLEAN_INTERPRETER_JSON_SCHEMA.properties.suppliedFields.items.additionalProperties, false);
  assert.equal(CLEAN_INTERPRETER_JSON_SCHEMA.properties.corrections.items.additionalProperties, false);
});
test("native Clean transport requests strict Structured Outputs", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw({ suppliedFields: [], ambiguity: null, confirmation: null })) } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const transport = new CleanOpenAiInterpreterTransport(
      { OPENAI_API_KEY: "test-key-with-sufficient-length", WARA_CLEAN_OPENAI_MODEL: "gpt-4o-mini" },
      { now: () => new Date("2026-08-17T16:00:00.000Z") },
    );
    await transport.call({ message: "structured", state: empty });
    assert.equal(requestBody?.response_format?.type, "json_schema");
    assert.equal(requestBody?.response_format?.json_schema?.strict, true);
    assert.deepEqual(requestBody?.response_format?.json_schema?.schema, CLEAN_INTERPRETER_JSON_SCHEMA);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("maps nullable strict-schema optionals without weakening typed values", () => {
  const result = mapStableInterpretation(raw({
    ambiguity: null,
    confirmation: null,
    references: [{ type: "unit", expression: "900115", source: "message", index: null, unitReferenceKind: "internal_code" }],
  }), empty);
  assert.equal(result?.ambiguity, undefined);
  assert.equal(result?.confirmation, undefined);
  assert.deepEqual(result?.references, [{ type: "unit", expression: "900115", source: "message", unitReferenceKind: "internal_code" }]);
});
test("maps corrections and confirmation without changing meaning", () => {
  const correction = mapStableInterpretation(raw({ userAct: "correction", relation: "continue", corrections: [{ field: "value", value: 120 }] }), empty);
  assert.deepEqual(correction?.corrections, [{ field: "value", value: 120 }]);
  const pending = { ...empty, pendingOperation: { operationId: "op", capability: "hourmeter.update", taskId: "task", version: 1, payloadHash: "hash", idempotencyKey: "idem", preparedArguments: {}, status: "awaiting_confirmation" as const } };
  const confirmation = mapStableInterpretation(raw({ userAct: "confirmation", relation: "confirm", confirmation: { intended: true, containsCorrections: false } }), pending);
  assert.deepEqual(confirmation?.confirmation, { intended: true, containsCorrections: false });
});
test("rejects contradictory confirmation semantics when no operation is pending", () => {
  const state = { ...empty, expectedInput: { field: "value" as const, taskId: null, purpose: "value" } };
  assert.equal(mapStableInterpretation(raw({ userAct: "confirmation", relation: "answer_expected", answersExpectedField: true,
    suppliedFields: [{ field: "value", value: 120 }], confirmation: { intended: true, containsCorrections: false } }), state), null);
});
test("unknown services are rejected instead of guessed", () => {
  assert.equal(mapStableInterpretation(raw({ requests: [{ serviceId: "unknown", domain: "gps", goal: "x", entities: {}, operationHint: "write" }] }), empty), null);
});
test("mapped interpretation is deeply immutable and detached from raw output", () => {
  const source = raw({
    requests: [
      { serviceId: "gps.get_status", domain: "gps", goal: "status", entities: { unit: { id: "u", metadata: { fleet: "f" } } }, operationHint: "read" },
      { serviceId: "certificate.prepare", domain: "certificate", goal: "prepare", entities: { unit: "u-2" }, operationHint: "write" },
    ],
    references: [{ type: "unit", expression: "truck" }],
    corrections: [{ field: "value", value: { previous: 100, next: 120 } }],
  });
  const result = mapStableInterpretation(source, empty)!;
  const unit = result.intents[0]!.entities.unit as { id: string; metadata: { fleet: string } };
  assert.throws(() => { unit.metadata.fleet = "other"; }, TypeError);
  assert.throws(() => { result.intents.push(result.intents[0]!); }, TypeError);
  assert.throws(() => { (result.references[0] as { expression: string }).expression = "other"; }, TypeError);
  assert.throws(() => { ((result.corrections[0]!.value as { next: number }).next) = 130; }, TypeError);
  (source.requests as Array<Record<string, unknown>>)[0]!.entities = { unit: "changed" };
  ((source.corrections as Array<{ value: { next: number } }>)[0]!.value).next = 999;
  assert.equal(unit.id, "u");
  assert.equal((result.corrections[0]!.value as { next: number }).next, 120);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.intents));
  assert.ok(Object.isFrozen(result.intents[0]!.entities));
  assert.ok(Object.isFrozen(unit.metadata));
});
test("deep freeze traverses children of an already frozen array and handles cycles", () => {
  const child = { nested: { value: 1 } };
  const frozenContainer = Object.freeze([child]);
  deepFreezeInterpretationValue(frozenContainer);
  assert.ok(Object.isFrozen(child));
  assert.ok(Object.isFrozen(child.nested));
  assert.throws(() => { child.nested.value = 2; }, TypeError);

  const cyclic: { child: { value: number }; self?: unknown } = { child: { value: 1 } };
  cyclic.self = cyclic;
  deepFreezeInterpretationValue(cyclic);
  assert.ok(Object.isFrozen(cyclic));
  assert.ok(Object.isFrozen(cyclic.child));
});
test("adapter converts invalid output and transport errors to safe null diagnostics", async () => {
  class Transport implements StableInterpreterTransport {
    constructor(private readonly output: unknown, private readonly fail = false) {}
    async call(): Promise<unknown> { if (this.fail) throw new Error("sensitive"); return this.output; }
  }
  const invalid = new StableInterpreterAdapter(new Transport("bad"));
  assert.equal(await invalid.interpret({ message: "opaque", state: empty }), null);
  assert.equal(invalid.lastDiagnostic?.code, "invalid_output");
  const failed = new StableInterpreterAdapter(new Transport(null, true));
  assert.equal(await failed.interpret({ message: "opaque", state: empty }), null);
  assert.equal(failed.lastDiagnostic?.code, "transport_error");
});
