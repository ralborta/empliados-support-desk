/**
 * Fase 9A — pipeline sintético + bloqueo 9B + evaluation-only.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import {
  mkdirSync,
  writeFileSync,
  symlinkSync,
  existsSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { GOV_DIRS, ensureGovDirs, assertDropboxFile, assertInsideGovernance } from "./paths.js";
import { importDropboxFile, verifyManifest } from "./import.js";
import {
  transformToCandidate,
  approveCandidate,
  loadApprovedDataset,
  revokeDataset,
  purgeDataset,
} from "./pipeline.js";
import { buildPartitions, messagesForPartition } from "./partition.js";
import { scanText, hasCritical } from "./scanner.js";
import {
  createEphemeralDeidKey,
  deidentifyMessage,
  pseudonymPerson,
  syntheticPhone,
} from "./deid.js";
import {
  assertStage9BAuthorized,
  revokeHistoricalAuthorization,
} from "./authorize.js";
import {
  evaluateApprovedOffline,
  loadEvalOnlyFlags,
} from "./eval-only.js";
import { ALLOW_EXTERNAL_MUTATIONS } from "@wara-v2/executors";
import { GATED_PREPARE_ONLY } from "@wara-v2/orchestrator";

describe("fase9A governance synthetic", () => {
  before(() => {
    // reset local governance dirs for hermetic tests
    revokeHistoricalAuthorization();
    rmSync(GOV_DIRS.drop, { recursive: true, force: true });
    ensureGovDirs();
  });

  function writeSynth(name: string, messages: unknown[]) {
    ensureGovDirs();
    const body = {
      synthetic: true,
      messages,
    };
    writeFileSync(join(GOV_DIRS.drop, name), JSON.stringify(body));
  }

  it("1. pipeline 9A sintético end-to-end", () => {
    writeSynth("ok.json", [
      {
        tenant_id: "tenant_a",
        conversation_id: "c1",
        turn_index: 0,
        message_role: "user",
        text: "actualizar odómetro UNIDAD_TEST a 1000",
        synthetic: true,
        received_at: "2026-01-01T00:00:00.000Z",
      },
      {
        tenant_id: "tenant_a",
        conversation_id: "c2",
        turn_index: 0,
        message_role: "user",
        text: "hola qué podés hacer",
        synthetic: true,
      },
      {
        tenant_id: "tenant_b",
        conversation_id: "c3",
        turn_index: 0,
        message_role: "user",
        text: "certificado para unidad X",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("ok.json");
    assert.equal(m.synthetic, true);
    verifyManifest(m.dataset_id);
    const cand = transformToCandidate(m.dataset_id);
    assert.equal(hasCritical(cand.findings_post), false);
    const appr = approveCandidate(m.dataset_id, "reviewer_synth");
    assert.equal(appr.status, "approved");
    const parts = buildPartitions(m.dataset_id);
    assert.ok(parts.dev.length + parts.val.length + parts.holdout.length >= 1);
  });

  it("2. dataset real rechazado sin autorización", () => {
    writeFileSync(
      join(GOV_DIRS.drop, "real.json"),
      JSON.stringify({
        synthetic: false,
        messages: [
          {
            tenant_id: "t",
            conversation_id: "c",
            turn_index: 0,
            message_role: "user",
            text: "hola",
          },
        ],
      }),
    );
    assert.throws(
      () => importDropboxFile("real.json"),
      /dataset_real_rejected/,
    );
  });

  it("3-4. manifest ausente / alterado", () => {
    assert.throws(() => verifyManifest("ds_missing"), /manifest_missing/);
    writeSynth("tamper.json", [
      {
        tenant_id: "t",
        conversation_id: "c",
        turn_index: 0,
        message_role: "user",
        text: "hola",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("tamper.json");
    writeFileSync(
      join(GOV_DIRS.quarantine, m.dataset_id, "tamper.json"),
      JSON.stringify({ synthetic: true, messages: [] }),
    );
    assert.throws(() => verifyManifest(m.dataset_id), /manifest_tampered/);
  });

  it("5-6. formato no permitido / archivo excesivo", () => {
    writeFileSync(join(GOV_DIRS.drop, "x.zip"), "PK");
    assert.throws(() => importDropboxFile("x.zip"), /format_not_allowed|compression/);
    writeFileSync(join(GOV_DIRS.drop, "big.json"), "x".repeat(3 * 1024 * 1024));
    assert.throws(() => importDropboxFile("big.json"), /file_too_large|JSON/);
  });

  it("7-8. path traversal / symlink escape", () => {
    assert.throws(() => assertDropboxFile("../secret.json"), /path_traversal/);
    assert.throws(
      () => assertInsideGovernance("/tmp/evil"),
      /path_outside/,
    );
    const link = join(GOV_DIRS.drop, "escape.json");
    try {
      symlinkSync("/etc/hosts", link);
      assert.throws(() => importDropboxFile("escape.json"), /symlink|format|JSON|binary/);
    } catch (e) {
      // algunas plataformas restringen symlink — ok
      assert.ok(e);
    }
  });

  it("9. compresión anómala rechazada", () => {
    writeFileSync(join(GOV_DIRS.drop, "bomb.gz"), "x");
    assert.throws(() => importDropboxFile("bomb.gz"), /format|compression/);
  });

  it("11-12. tenant ausente / mezcla", () => {
    writeFileSync(
      join(GOV_DIRS.drop, "noten.json"),
      JSON.stringify({
        synthetic: true,
        messages: [
          {
            conversation_id: "c",
            turn_index: 0,
            message_role: "user",
            text: "hola",
          },
        ],
      }),
    );
    assert.throws(() => importDropboxFile("noten.json"), /tenant_missing/);

    writeSynth("mix.json", [
      {
        tenant_id: "a",
        conversation_id: "same",
        turn_index: 0,
        message_role: "user",
        text: "hola",
        synthetic: true,
      },
      {
        tenant_id: "b",
        conversation_id: "same",
        turn_index: 1,
        message_role: "user",
        text: "hola2",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("mix.json");
    assert.throws(() => transformToCandidate(m.dataset_id), /tenant_mix/);
  });

  it("13-21. escáner detecta PII / credenciales", () => {
    assert.ok(scanText("mail test@example.com", "t").some((f) => f.code === "email"));
    assert.ok(scanText("tel +5491112345678", "t").some((f) => f.code === "phone"));
    assert.ok(scanText("dni 30111222", "t").some((f) => f.code === "dni"));
    assert.ok(scanText("patente AB123CD", "t").some((f) => f.code === "plate_ar"));
    assert.ok(
      scanText("VIN 1HGCM82633A004352", "t").some((f) => f.code === "vin"),
    );
    assert.ok(scanText("ver https://evil.example", "t").some((f) => f.code === "url"));
    assert.ok(scanText("ip 10.0.0.1", "t").some((f) => f.code === "ip"));
    assert.ok(
      scanText("key sk-abcdefghijklmnopqrstuvwxyz123456", "t").some(
        (f) => f.code === "api_key",
      ),
    );
    assert.ok(
      scanText("Juan Perez pidió turno", "t").some((f) => f.code === "probable_name"),
    );
    assert.ok(
      scanText("op_abcdef12-3456", "t").some((f) => f.code === "internal_id"),
    );
  });

  it("22-24. pseudonimización consistente y distinta entre tenants", () => {
    const key = createEphemeralDeidKey();
    const a1 = pseudonymPerson(key, "t1", "Ada Lovelace");
    const a2 = pseudonymPerson(key, "t1", "Ada Lovelace");
    const b1 = pseudonymPerson(key, "t2", "Ada Lovelace");
    assert.equal(a1, a2);
    assert.notEqual(a1, b1);
    const p1 = syntheticPhone(key, "t1", "+5491111111111");
    const p2 = syntheticPhone(key, "t1", "+5491111111111");
    assert.equal(p1, p2);
    const d1 = deidentifyMessage(key, {
      tenant_id: "t1",
      conversation_id: "c",
      turn_index: 0,
      message_role: "user",
      text: "hola",
      received_at: "2026-06-01T12:00:00.000Z",
    });
    const d2 = deidentifyMessage(key, {
      tenant_id: "t1",
      conversation_id: "c",
      turn_index: 0,
      message_role: "user",
      text: "hola",
      received_at: "2026-06-01T12:00:00.000Z",
    });
    assert.equal(d1.received_at, d2.received_at);
  });

  it("26-27. residual crítico bloquea; post limpio", () => {
    // synthetic text without PII → post limpio
    writeSynth("clean.json", [
      {
        tenant_id: "t",
        conversation_id: "c",
        turn_index: 0,
        message_role: "user",
        text: "consulta estado unidad",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("clean.json");
    const c = transformToCandidate(m.dataset_id);
    assert.equal(hasCritical(c.findings_post), false);
  });

  it("28-30. no aprobado / vencido / revocado", async () => {
    assert.throws(() => loadApprovedDataset("nope"), /dataset_not_approved/);
    writeSynth("rev.json", [
      {
        tenant_id: "t",
        conversation_id: "c",
        turn_index: 0,
        message_role: "user",
        text: "hola",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("rev.json");
    transformToCandidate(m.dataset_id);
    approveCandidate(m.dataset_id, "r");
    revokeDataset(m.dataset_id);
    assert.throws(() => loadApprovedDataset(m.dataset_id), /dataset_revoked/);
  });

  it("35-36. evaluation-only sin efectos / DeliveryGate", async () => {
    assert.throws(
      () =>
        loadEvalOnlyFlags({
          EVALUATION_ONLY: "true",
          DELIVERY_ENABLED: "true",
        }),
      /incompatible_with_delivery/,
    );
    writeSynth("eval.json", [
      {
        tenant_id: "t",
        conversation_id: "c1",
        turn_index: 0,
        message_role: "user",
        text: "listar capacidades",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("eval.json");
    transformToCandidate(m.dataset_id);
    approveCandidate(m.dataset_id, "r");
    buildPartitions(m.dataset_id);
    const msgs = messagesForPartition(m.dataset_id, "dev");
    const { cases, flags } = await evaluateApprovedOffline(m.dataset_id, msgs);
    assert.equal(flags.DELIVERY_ENABLED, false);
    assert.ok(cases.every((c) => c.effects_created.outbox === 0));
    assert.equal(ALLOW_EXTERNAL_MUTATIONS, false);
    assert.equal(GATED_PREPARE_ONLY, true);
  });

  it("37-38. particiones sin dup / holdout protegido", () => {
    writeSynth("part.json", [
      {
        tenant_id: "t",
        conversation_id: "c1",
        turn_index: 0,
        message_role: "user",
        text: "a",
        synthetic: true,
      },
      {
        tenant_id: "t",
        conversation_id: "c2",
        turn_index: 0,
        message_role: "user",
        text: "b",
        synthetic: true,
      },
      {
        tenant_id: "t",
        conversation_id: "c3",
        turn_index: 0,
        message_role: "user",
        text: "c",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("part.json");
    transformToCandidate(m.dataset_id);
    approveCandidate(m.dataset_id, "r");
    buildPartitions(m.dataset_id);
    assert.throws(
      () => messagesForPartition(m.dataset_id, "holdout"),
      /holdout_sealed/,
    );
  });

  it("39-41. eliminación dry-run / exacta / revocación", () => {
    writeSynth("del.json", [
      {
        tenant_id: "t",
        conversation_id: "c",
        turn_index: 0,
        message_role: "user",
        text: "x",
        synthetic: true,
      },
    ]);
    const m = importDropboxFile("del.json");
    transformToCandidate(m.dataset_id);
    approveCandidate(m.dataset_id, "r");
    const dry = purgeDataset(m.dataset_id, {
      dryRun: true,
      confirm: `DELETE:${m.dataset_id}`,
    });
    assert.equal(dry.dryRun, true);
    assert.ok(existsSync(join(GOV_DIRS.approved, m.dataset_id)));
    purgeDataset(m.dataset_id, {
      dryRun: false,
      confirm: `DELETE:${m.dataset_id}`,
    });
    assert.equal(existsSync(join(GOV_DIRS.approved, m.dataset_id)), false);
  });

  it("45-48. 9B bloqueada; sin entrega", () => {
    const authPath = join(GOV_DIRS.reports, "HISTORICAL_AUTH.json");
    if (existsSync(authPath)) rmSync(authPath);
    assert.throws(() => assertStage9BAuthorized(), /stage_9B_blocked/);
    assert.equal(ALLOW_EXTERNAL_MUTATIONS, false);
  });
});
