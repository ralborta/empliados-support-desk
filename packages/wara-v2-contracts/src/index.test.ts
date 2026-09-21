import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import {
  ExpectedEffectSchema,
  MODEL_CANNOT_ORDER_COMMIT,
  ModelToolHintNameSchema,
  OrchestratorDecisionSchema,
  PG_SOLE_LOCK_AUTHORITY,
  V2_DEFAULTS,
  parseOrchestratorDecision,
  payloadHash,
  parseCanonicalIngress,
  CANONICAL_INGRESS_SCHEMA_VERSION,
  tenantScopedKey,
  parseLlmProposal,
  LLM_PROPOSAL_CONTRACT_VERSION,
} from "./index.js";

const validDecision = {
  schemaVersion: 2 as const,
  interpretationSummary: "Usuario confirma odómetro",
  proposedGoal: "update_odometer" as const,
  acts: [
    {
      act_id: "a1",
      type: "confirm" as const,
      order: 0,
      priority: 50,
      blocking: false,
      depends_on: [] as string[],
      conflicts_with: [] as string[],
      expected_effect: "none" as const,
      confidence: 0.9,
      target: {
        operationId: "op_1",
        operationVersion: 1,
      },
    },
  ],
};

describe("wara-v2 contracts", () => {
  it("parsea OrchestratorDecision válido", () => {
    const r = parseOrchestratorDecision(validDecision);
    assert.equal(r.ok, true);
  });

  it("rechaza expected_effect commit", () => {
    const r = ExpectedEffectSchema.safeParse("commit");
    assert.equal(r.success, false);
  });

  it("rechaza commit_* en tool hints", () => {
    const r = ModelToolHintNameSchema.safeParse("commit_odometer_update");
    assert.equal(r.success, false);
  });

  it("rechaza act_id duplicados (post-schema)", () => {
    const r = parseOrchestratorDecision({
      ...validDecision,
      acts: [
        validDecision.acts[0],
        { ...validDecision.acts[0], order: 1 },
      ],
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.issues.some((i) => i.code === "duplicate_act_id"));
    }
  });

  it("rechaza ciclo depends_on", () => {
    const r = parseOrchestratorDecision({
      ...validDecision,
      acts: [
        {
          ...validDecision.acts[0],
          act_id: "a1",
          depends_on: ["a2"],
        },
        {
          ...validDecision.acts[0],
          act_id: "a2",
          order: 1,
          depends_on: ["a1"],
        },
      ],
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.issues.some((i) => i.code === "depends_on_cycle"));
    }
  });

  it("rechaza properties adicionales", () => {
    const r = OrchestratorDecisionSchema.safeParse({
      ...validDecision,
      toolCalls: [{ name: "commit_odometer_update" }],
    });
    assert.equal(r.success, false);
  });

  it("payloadHash es determinista con keys ordenadas", async () => {
    const a = await payloadHash({ b: 1, a: 2 });
    const b = await payloadHash({ a: 2, b: 1 });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("defaults y banderas de diseño", () => {
    assert.equal(V2_DEFAULTS.WARA_V2_EXECUTION_MODE, "dry_run");
    assert.equal(V2_DEFAULTS.MODEL_MAX_RETRIES, 1);
    assert.equal(MODEL_CANNOT_ORDER_COMMIT, true);
    assert.equal(PG_SOLE_LOCK_AUTHORITY, true);
  });
});

describe("CanonicalIngressSchema", () => {
  const base = () => ({
    schema_version: CANONICAL_INGRESS_SCHEMA_VERSION,
    source: "synthetic" as const,
    tenant_id: "t1",
    external_conversation_id: "c1",
    external_message_id: "m1",
    received_at: new Date().toISOString(),
    message_type: "text" as const,
    content: { text: "hola" },
    correlation_id: randomUUID(),
    is_shadow: true,
  });

  it("acepta ingress canónico v1", () => {
    const p = parseCanonicalIngress(base());
    assert.equal(p.schema_version, 1);
    assert.equal(tenantScopedKey("t1", "c1"), "t1::c1");
  });

  it("rechaza tools / metadata no allowlisted", () => {
    assert.throws(() => parseCanonicalIngress({ ...base(), tools: [] }));
    assert.throws(() =>
      parseCanonicalIngress({
        ...base(),
        metadata: { evil: "x" },
      }),
    );
  });
});

describe("LlmProposalSchema", () => {
  it("acepta propuesta v1 y rechaza commit/tools", () => {
    const p = parseLlmProposal({
      contract_version: LLM_PROPOSAL_CONTRACT_VERSION,
      proposed_intent: "clarify",
      proposed_act_type: "unclear",
      extracted_fields: {},
      missing_fields: ["unit"],
      confidence: 0.5,
      proposed_user_reply: "¿Qué unidad?",
      needs_clarification: true,
      evidence_refs: [],
      reason_codes: ["needs_clarification"],
    });
    assert.equal(p.contract_version, 1);
    assert.throws(() =>
      parseLlmProposal({
        contract_version: 1,
        proposed_intent: "update_odometer",
        proposed_act_type: "new_request",
        extracted_fields: {},
        missing_fields: [],
        confidence: 0.9,
        proposed_user_reply: "x",
        needs_clarification: false,
        evidence_refs: [],
        reason_codes: ["ok"],
        commit: true,
      }),
    );
  });
});
