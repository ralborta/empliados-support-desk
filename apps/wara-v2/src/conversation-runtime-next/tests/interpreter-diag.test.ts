import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInterpretation, coerceInterpretationRaw } from "../interpreter/coerce.js";
import {
  classifyHttpFailure,
  classifyThrownError,
  sanitizeForTrace,
} from "../interpreter/diagnostics.js";

describe("interpreter coerce", () => {
  it("normaliza enums inválidos", () => {
    const raw = coerceInterpretationRaw({
      userAct: "saludo",
      relation: "greeting",
      normalizedMeaning: "Hola",
      requests: [{ domain: "gps", entities: {} }],
    });
    const p = parseInterpretation(raw);
    assert.ok(p.ok);
    assert.equal(p.data.userAct, "unknown");
    assert.equal(p.data.relation, "ambiguous");
    assert.ok(p.data.requests[0]?.goal);
  });

  it("convierte entities array a record", () => {
    const p = parseInterpretation({
      userAct: "question",
      relation: "standalone",
      normalizedMeaning: "empresa",
      requests: [
        {
          domain: "company",
          goal: "empresa",
          entities: [{ companyId: "1" }],
          operationHint: "query",
        },
      ],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.8,
    });
    assert.ok(p.ok);
    assert.deepEqual(p.data.requests[0]!.entities, { companyId: "1" });
    assert.equal(p.data.requests[0]!.operationHint, "read");
  });

  it("rellena goal vacío en requests", () => {
    const p = parseInterpretation({
      userAct: "request",
      relation: "standalone",
      normalizedMeaning: "GPS",
      requests: [{ serviceId: "gps.status", domain: "gps", goal: "", entities: {} }],
      references: [],
      corrections: [],
      answersExpectedField: false,
      confidence: 0.9,
    });
    assert.ok(p.ok);
    assert.ok(p.data.requests[0]!.goal.length > 0);
  });
});

describe("interpreter diagnostics", () => {
  it("clasifica http 429", () => {
    assert.equal(classifyHttpFailure(429, ""), "rate_limit");
  });
  it("clasifica timeout", () => {
    assert.equal(classifyThrownError("llm_timeout"), "timeout");
  });
  it("sanitiza api keys", () => {
    const s = sanitizeForTrace("Bearer sk-proj-abcdefghijklmnopqrstuvwxyz");
    assert.ok(!s.includes("sk-proj"));
  });
});
