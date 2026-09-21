/**
 * Orquestación Fase 9B: auth → import → deid → approve → partitions → eval-only.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GOV_DIRS, ensureGovDirs } from "./paths.js";
import {
  authorizeAndBind,
  importAuthorizedHistorical,
  validateHistoricalExport,
} from "./historical.js";
import {
  transformToCandidate,
  approveCandidate,
  loadApprovedDataset,
} from "./pipeline.js";
import { buildPartitions, messagesForPartition } from "./partition.js";
import { evaluateApprovedOffline } from "./eval-only.js";
import { hasCritical } from "./scanner.js";
import type { HistoricalAuth } from "./authorize.js";

export type Phase9BReport = {
  authorization_id: string;
  file_sha256: string;
  conversations_accepted: number;
  conversations_rejected: number;
  period_effective: { from: string | null; to: string | null };
  fields_seen: string[];
  fields_discarded: string[];
  scan: {
    pre_critical: number;
    post_critical: number;
    pre_count: number;
    post_count: number;
  };
  human_review: {
    sample_size: number;
    sample_path: string;
    status: "pending_human" | "approved";
  };
  partitions: { dev: number; val: number; holdout: number };
  eval: {
    cases: number;
    intent_accuracy: number | null;
    clarify_cases: number;
    policy_rejects: number;
    effects: { operations: 0; attempts: 0; outbox: 0; deliveries: 0 };
    note: string;
  };
  expires_at: string;
  dataset_id: string;
};

export async function runPhase9BPipeline(opts: {
  filename: string;
  approver?: string;
  /** Si true, emite HISTORICAL_AUTH ligado al hash (requiere validación OK). */
  issueAuth?: boolean;
  /** Marca revisión humana aprobada (después de inspeccionar muestra). */
  humanApproved?: boolean;
}): Promise<Phase9BReport> {
  ensureGovDirs();
  const validation = validateHistoricalExport(opts.filename);
  if (!validation.ok) {
    throw new Error(`9b_validation_failed:${validation.errors.join("|")}`);
  }

  let auth: HistoricalAuth;
  if (opts.issueAuth !== false) {
    auth = authorizeAndBind(opts.filename).auth;
  } else {
    // auth ya debe existir y coincidir con el hash
    const v = validateHistoricalExport(opts.filename);
    const { assertAuthMatchesFile } = await import("./authorize.js");
    auth = assertAuthMatchesFile(v.sha256, opts.filename);
  }

  const manifest = importAuthorizedHistorical(opts.filename);
  const cand = transformToCandidate(manifest.dataset_id);
  if (hasCritical(cand.findings_post)) {
    throw new Error("critical_residual_blocks_export");
  }

  // Muestra humana: primeros 15 textos desidentificados (sin PII original)
  const sample = cand.messages.slice(0, 15).map((m) => ({
    conversation_id: m.conversation_id,
    turn_index: m.turn_index,
    role: m.message_role,
    text: m.text.slice(0, 400),
  }));
  const samplePath = join(
    GOV_DIRS.reports,
    `human-sample-${auth.authorization_id}.json`,
  );
  writeFileSync(samplePath, JSON.stringify({ sample, note: "desidentificado" }, null, 2));

  if (!opts.humanApproved) {
    writeFileSync(
      join(GOV_DIRS.reports, `9b-pending-human-${auth.authorization_id}.json`),
      JSON.stringify(
        {
          status: "pending_human_review",
          sample_path: samplePath,
          next: "Revisar muestra y re-ejecutar con --human-approved",
        },
        null,
        2,
      ),
    );
    return {
      authorization_id: auth.authorization_id,
      file_sha256: auth.file_sha256,
      conversations_accepted: validation.accepted_conversations,
      conversations_rejected: validation.rejected_conversations,
      period_effective: validation.period_effective,
      fields_seen: validation.fields_seen,
      fields_discarded: validation.fields_discarded,
      scan: {
        pre_critical: cand.findings_pre.filter((f) => f.severity === "critical")
          .length,
        post_critical: cand.findings_post.filter((f) => f.severity === "critical")
          .length,
        pre_count: cand.findings_pre.length,
        post_count: cand.findings_post.length,
      },
      human_review: {
        sample_size: sample.length,
        sample_path: samplePath,
        status: "pending_human",
      },
      partitions: { dev: 0, val: 0, holdout: 0 },
      eval: {
        cases: 0,
        intent_accuracy: null,
        clarify_cases: 0,
        policy_rejects: 0,
        effects: { operations: 0, attempts: 0, outbox: 0, deliveries: 0 },
        note: "pending_human",
      },
      expires_at: auth.expires_at,
      dataset_id: manifest.dataset_id,
    };
  }

  approveCandidate(manifest.dataset_id, opts.approver ?? auth.approver);
  const parts = buildPartitions(manifest.dataset_id);
  const devMsgs = messagesForPartition(manifest.dataset_id, "dev");
  const { cases, summary } = await evaluateApprovedOffline(
    manifest.dataset_id,
    devMsgs,
  );

  mkdirSync(GOV_DIRS.evalResults, { recursive: true });
  const report: Phase9BReport = {
    authorization_id: auth.authorization_id,
    file_sha256: auth.file_sha256,
    conversations_accepted: validation.accepted_conversations,
    conversations_rejected: validation.rejected_conversations,
    period_effective: validation.period_effective,
    fields_seen: validation.fields_seen,
    fields_discarded: validation.fields_discarded,
    scan: {
      pre_critical: cand.findings_pre.filter((f) => f.severity === "critical")
        .length,
      post_critical: cand.findings_post.filter((f) => f.severity === "critical")
        .length,
      pre_count: cand.findings_pre.length,
      post_count: cand.findings_post.length,
    },
    human_review: {
      sample_size: sample.length,
      sample_path: samplePath,
      status: "approved",
    },
    partitions: {
      dev: parts.dev.length,
      val: parts.val.length,
      holdout: parts.holdout.length,
    },
    eval: {
      cases: cases.length,
      intent_accuracy: summary.intent_accuracy,
      clarify_cases: summary.clarify_cases,
      policy_rejects: summary.policy_rejects,
      effects: { operations: 0, attempts: 0, outbox: 0, deliveries: 0 },
      note: "FakeModelAdapter offline; comparar vs Fase8 OpenAI sintético en docs/v2/FASE8-CIERRE-METRICAS.md",
    },
    expires_at: auth.expires_at,
    dataset_id: manifest.dataset_id,
  };
  writeFileSync(
    join(GOV_DIRS.evalResults, `9b-report-${auth.authorization_id}.json`),
    JSON.stringify(report, null, 2),
  );
  void loadApprovedDataset;
  return report;
}
