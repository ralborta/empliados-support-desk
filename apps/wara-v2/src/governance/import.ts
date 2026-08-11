/**
 * Importación a cuarentena — solo dropbox local, formatos allowlisted.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  GOV_DIRS,
  assertDropboxFile,
  assertInsideGovernance,
  ensureGovDirs,
} from "./paths.js";
import { assertStage9AOnly, assertStage9BAuthorized } from "./authorize.js";

export const ALLOWED_EXTENSIONS = new Set([".jsonl", ".json"]);
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDS = 500;

export type ImportManifest = {
  manifest_version: 1;
  dataset_id: string;
  source_filename: string;
  sha256: string;
  bytes: number;
  records: number;
  synthetic: boolean;
  stage: "9A" | "9B";
  imported_at: string;
  status: "quarantine";
};

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function importDropboxFile(
  filename: string,
  opts?: { forceHistorical?: boolean },
): ImportManifest {
  ensureGovDirs();
  const src = assertDropboxFile(filename);
  if (!existsSync(src)) throw new Error("dropbox_file_missing");

  const st = lstatSync(src);
  if (st.isSymbolicLink()) {
    assertInsideGovernance(src); // also checks realpath escape
  }

  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("format_not_allowed");
  if (/\.(zip|gz|tgz|7z|rar)$/i.test(filename)) {
    throw new Error("compression_not_allowed");
  }

  const size = statSync(src).size;
  if (size > MAX_BYTES) throw new Error("file_too_large");

  const raw = readFileSync(src, "utf8");
  if (raw.includes("\0")) throw new Error("binary_content_forbidden");

  let records = 0;
  let synthetic = true;
  if (ext === ".jsonl") {
    const lines = raw.split("\n").filter((l) => l.trim());
    records = lines.length;
    if (records > MAX_RECORDS) throw new Error("too_many_records");
    for (const line of lines) {
      const obj = JSON.parse(line) as { synthetic?: boolean; tenant_id?: string };
      if (!obj.tenant_id) throw new Error("tenant_missing");
      if (obj.synthetic !== true) synthetic = false;
    }
  } else {
    const obj = JSON.parse(raw) as {
      synthetic?: boolean;
      messages?: Array<{ tenant_id?: string; synthetic?: boolean }>;
    };
    const msgs = obj.messages ?? [];
    records = msgs.length;
    if (records > MAX_RECORDS) throw new Error("too_many_records");
    if (obj.synthetic !== true) synthetic = false;
    for (const m of msgs) {
      if (!m.tenant_id) throw new Error("tenant_missing");
    }
  }

  if (!synthetic) {
    if (!opts?.forceHistorical) {
      throw new Error("dataset_real_rejected_without_authorization");
    }
    assertStage9BAuthorized();
  } else {
    assertStage9AOnly();
  }

  const hash = sha256File(src);
  const datasetId = `ds_${hash.slice(0, 12)}`;
  const destDir = join(GOV_DIRS.quarantine, datasetId);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(filename));
  assertInsideGovernance(dest);
  copyFileSync(src, dest);

  const manifest: ImportManifest = {
    manifest_version: 1,
    dataset_id: datasetId,
    source_filename: filename,
    sha256: hash,
    bytes: size,
    records,
    synthetic,
    stage: synthetic ? "9A" : "9B",
    imported_at: new Date().toISOString(),
    status: "quarantine",
  };
  writeFileSync(
    join(destDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}

export function verifyManifest(datasetId: string): ImportManifest {
  const manifestPath = assertInsideGovernance(
    join(GOV_DIRS.quarantine, datasetId, "manifest.json"),
  );
  if (!existsSync(manifestPath)) throw new Error("manifest_missing");
  const m = JSON.parse(readFileSync(manifestPath, "utf8")) as ImportManifest;
  const file = join(GOV_DIRS.quarantine, datasetId, m.source_filename);
  if (sha256File(file) !== m.sha256) throw new Error("manifest_tampered");
  return m;
}
