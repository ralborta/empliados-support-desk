/**
 * Pipeline 9A: cuarentena → deid → scan → candidate → approve → partitions.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GOV_DIRS, assertInsideGovernance, ensureGovDirs } from "./paths.js";
import { verifyManifest } from "./import.js";
import {
  createEphemeralDeidKey,
  deidentifyMessage,
  type RawMessage,
  type DeidMessage,
} from "./deid.js";
import { scanRecord, hasCritical, type PrivacyFinding } from "./scanner.js";
import { assertStage9BAuthorized } from "./authorize.js";

export type DatasetStatus =
  | "candidate"
  | "approved"
  | "expired"
  | "revoked";

export type DatasetApproval = {
  dataset_id: string;
  status: DatasetStatus;
  version: number;
  content_sha256: string;
  approved_by?: string;
  approved_at?: string;
  expires_at?: string;
  purpose: string;
  synthetic: boolean;
};

function loadMessages(datasetId: string, filename: string): RawMessage[] {
  const path = assertInsideGovernance(
    join(GOV_DIRS.quarantine, datasetId, filename),
  );
  const raw = readFileSync(path, "utf8");
  if (filename.endsWith(".jsonl")) {
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as RawMessage);
  }
  const obj = JSON.parse(raw) as { messages: RawMessage[] };
  return obj.messages;
}

export function transformToCandidate(datasetId: string): {
  findings_pre: PrivacyFinding[];
  findings_post: PrivacyFinding[];
  messages: DeidMessage[];
  content_sha256: string;
} {
  ensureGovDirs();
  const manifest = verifyManifest(datasetId);
  if (!manifest.synthetic) {
    assertStage9BAuthorized();
  }

  const msgs = loadMessages(datasetId, manifest.source_filename);
  const tenants = new Set(msgs.map((m) => m.tenant_id));
  // mezcla de tenants en un mismo conversation_id no sintética → error
  const byConv = new Map<string, Set<string>>();
  for (const m of msgs) {
    const s = byConv.get(m.conversation_id) ?? new Set();
    s.add(m.tenant_id);
    byConv.set(m.conversation_id, s);
  }
  for (const [, set] of byConv) {
    if (set.size > 1) throw new Error("tenant_mix_in_conversation");
  }
  void tenants;

  const findings_pre: PrivacyFinding[] = [];
  for (let i = 0; i < msgs.length; i++) {
    findings_pre.push(...scanRecord(msgs[i] as unknown as Record<string, unknown>, `msg[${i}]`));
  }

  const key = createEphemeralDeidKey();
  const deid = msgs.map((m) => deidentifyMessage(key, m));
  // clave efímera no se escribe
  const rawConvs = new Set(msgs.map((m) => m.conversation_id));
  const deidConvs = new Set(deid.map((m) => m.conversation_id));
  if (deidConvs.size !== rawConvs.size) {
    throw new Error(
      `deid_conversation_id_collision:raw=${rawConvs.size};deid=${deidConvs.size}`,
    );
  }
  const findings_post: PrivacyFinding[] = [];
  for (let i = 0; i < deid.length; i++) {
    findings_post.push(
      ...scanRecord(deid[i] as unknown as Record<string, unknown>, `deid[${i}]`),
    );
  }
  // post-scan: críticos residuales bloquean
  if (hasCritical(findings_post)) {
    throw new Error("critical_residual_blocks_export");
  }

  const content = JSON.stringify(deid);
  const content_sha256 = createHash("sha256").update(content).digest("hex");
  const outDir = join(GOV_DIRS.candidate, datasetId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "messages.json"), content);
  writeFileSync(
    join(outDir, "scan-report.json"),
    JSON.stringify(
      {
        findings_pre: findings_pre.map((f) => ({ ...f })),
        findings_post: findings_post.map((f) => ({ ...f })),
        // sin valores sensibles
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(outDir, "meta.json"),
    JSON.stringify(
      {
        dataset_id: datasetId,
        status: "candidate" satisfies DatasetStatus,
        version: 1,
        content_sha256,
        purpose: "offline_evaluation",
        synthetic: manifest.synthetic,
      } satisfies DatasetApproval,
      null,
      2,
    ),
  );
  return { findings_pre, findings_post, messages: deid, content_sha256 };
}

export function approveCandidate(
  datasetId: string,
  approver: string,
  retentionDays = 30,
): DatasetApproval {
  const metaPath = assertInsideGovernance(
    join(GOV_DIRS.candidate, datasetId, "meta.json"),
  );
  const messagesPath = join(GOV_DIRS.candidate, datasetId, "messages.json");
  if (!existsSync(metaPath) || !existsSync(messagesPath)) {
    throw new Error("candidate_missing");
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as DatasetApproval;
  const hash = createHash("sha256")
    .update(readFileSync(messagesPath))
    .digest("hex");
  if (hash !== meta.content_sha256) throw new Error("candidate_tampered");

  const approved: DatasetApproval = {
    ...meta,
    status: "approved",
    approved_by: approver,
    approved_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + retentionDays * 24 * 3600 * 1000,
    ).toISOString(),
  };
  const outDir = join(GOV_DIRS.approved, datasetId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "messages.json"), readFileSync(messagesPath));
  writeFileSync(join(outDir, "approval.json"), JSON.stringify(approved, null, 2));
  // hash del paquete aprobado
  writeFileSync(
    join(outDir, "approval.sha256"),
    createHash("sha256")
      .update(JSON.stringify(approved) + hash)
      .digest("hex"),
  );
  return approved;
}

export function loadApprovedDataset(datasetId: string): {
  messages: DeidMessage[];
  approval: DatasetApproval;
} {
  const approvalPath = assertInsideGovernance(
    join(GOV_DIRS.approved, datasetId, "approval.json"),
  );
  if (!existsSync(approvalPath)) throw new Error("dataset_not_approved");
  const approval = JSON.parse(
    readFileSync(approvalPath, "utf8"),
  ) as DatasetApproval;
  if (approval.status === "revoked") throw new Error("dataset_revoked");
  if (approval.status !== "approved") throw new Error("dataset_not_approved");
  if (approval.expires_at && Date.parse(approval.expires_at) < Date.now()) {
    throw new Error("dataset_expired");
  }
  const messages = JSON.parse(
    readFileSync(join(GOV_DIRS.approved, datasetId, "messages.json"), "utf8"),
  ) as DeidMessage[];
  return { messages, approval };
}

export function revokeDataset(datasetId: string): void {
  const approvalPath = join(GOV_DIRS.approved, datasetId, "approval.json");
  assertInsideGovernance(approvalPath);
  if (!existsSync(approvalPath)) throw new Error("dataset_not_approved");
  const approval = JSON.parse(
    readFileSync(approvalPath, "utf8"),
  ) as DatasetApproval;
  approval.status = "revoked";
  writeFileSync(approvalPath, JSON.stringify(approval, null, 2));
}

export function purgeDataset(
  datasetId: string,
  opts: { dryRun: boolean; confirm: string },
): { deleted: string[]; dryRun: boolean } {
  if (opts.confirm !== `DELETE:${datasetId}`) {
    throw new Error("deletion_confirm_required");
  }
  const targets = [
    join(GOV_DIRS.quarantine, datasetId),
    join(GOV_DIRS.candidate, datasetId),
    join(GOV_DIRS.approved, datasetId),
  ].map(assertInsideGovernance);

  const deleted: string[] = [];
  for (const t of targets) {
    if (existsSync(t)) {
      deleted.push(t);
      if (!opts.dryRun) rmSync(t, { recursive: true, force: true });
    }
  }
  // registro de eliminación sin contenido
  writeFileSync(
    join(GOV_DIRS.reports, `purge-${datasetId}-${Date.now()}.json`),
    JSON.stringify(
      {
        dataset_id: datasetId,
        deleted_paths_count: deleted.length,
        dryRun: opts.dryRun,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { deleted, dryRun: opts.dryRun };
}
