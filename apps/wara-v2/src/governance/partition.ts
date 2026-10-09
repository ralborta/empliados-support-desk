/**
 * Particiones desarrollo / validación / holdout — sin duplicados.
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GOV_DIRS, assertInsideGovernance } from "./paths.js";
import type { DeidMessage } from "./deid.js";
import { loadApprovedDataset } from "./pipeline.js";

export type PartitionName = "dev" | "val" | "holdout";

export type Partitions = Record<PartitionName, string[]>; // conversation_ids

function convHash(id: string): number {
  return parseInt(createHash("sha256").update(id).digest("hex").slice(0, 8), 16);
}

export function buildPartitions(
  datasetId: string,
  ratios = { dev: 0.6, val: 0.2, holdout: 0.2 },
): Partitions {
  const { messages, approval } = loadApprovedDataset(datasetId);
  if (!approval.synthetic && approval.status !== "approved") {
    throw new Error("partition_requires_approved");
  }
  const convs = [...new Set(messages.map((m) => m.conversation_id))].sort();
  const parts: Partitions = { dev: [], val: [], holdout: [] };
  for (const c of convs) {
    const r = (convHash(c) % 1000) / 1000;
    if (r < ratios.dev) parts.dev.push(c);
    else if (r < ratios.dev + ratios.val) parts.val.push(c);
    else parts.holdout.push(c);
  }
  // sin duplicados entre particiones
  const all = [...parts.dev, ...parts.val, ...parts.holdout];
  if (new Set(all).size !== all.length) throw new Error("partition_duplicates");

  const out = join(GOV_DIRS.approved, datasetId, "partitions.json");
  assertInsideGovernance(out);
  writeFileSync(
    out,
    JSON.stringify(
      { dataset_id: datasetId, sealed_holdout: true, partitions: parts },
      null,
      2,
    ),
  );
  return parts;
}

export function assertHoldoutProtected(datasetId: string): void {
  const p = join(GOV_DIRS.approved, datasetId, "partitions.json");
  if (!existsSync(p)) throw new Error("partitions_missing");
  const doc = JSON.parse(readFileSync(p, "utf8")) as {
    sealed_holdout: boolean;
  };
  if (!doc.sealed_holdout) throw new Error("holdout_not_protected");
}

export function messagesForPartition(
  datasetId: string,
  part: PartitionName,
  opts?: { allowHoldout?: boolean },
): DeidMessage[] {
  if (part === "holdout" && !opts?.allowHoldout) {
    throw new Error("holdout_sealed");
  }
  assertHoldoutProtected(datasetId);
  const { messages } = loadApprovedDataset(datasetId);
  const doc = JSON.parse(
    readFileSync(join(GOV_DIRS.approved, datasetId, "partitions.json"), "utf8"),
  ) as { partitions: Partitions };
  const set = new Set(doc.partitions[part]);
  return messages.filter((m) => set.has(m.conversation_id));
}
