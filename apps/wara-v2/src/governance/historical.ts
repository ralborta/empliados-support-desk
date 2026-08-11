/**
 * Validación e importación histórica 9B (archivo manual en dropbox).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOV_DIRS,
  assertDropboxFile,
  ensureGovDirs,
} from "./paths.js";
import {
  assertAuthMatchesFile,
  assertStage9BAuthorized,
  issueHistoricalAuthorization,
  loadHistoricalAuthorization,
  type HistoricalAuth,
  DEFAULT_FORBIDDEN_FIELDS,
  HISTORICAL_VOLUME,
} from "./authorize.js";
import { importDropboxFile, type ImportManifest } from "./import.js";

export type HistoricalMessage = {
  tenant_id: string;
  conversation_id: string;
  turn_index: number;
  message_role: "user" | "assistant" | "system";
  text: string;
  received_at?: string;
  golden_expected?: { intent?: string; must_clarify?: boolean };
  /** Debe ser false o ausente para histórico */
  synthetic?: boolean;
};

export type HistoricalExport = {
  synthetic: false;
  tenant_id: string;
  period?: { from: string; to: string };
  messages: HistoricalMessage[];
};

export type ValidateResult = {
  ok: boolean;
  conversation_count: number;
  message_count: number;
  accepted_conversations: number;
  rejected_conversations: number;
  reject_reasons: string[];
  fields_seen: string[];
  fields_discarded: string[];
  period_effective: { from: string | null; to: string | null };
  sha256: string;
  errors: string[];
};

const PERIOD_FROM = Date.parse("2026-05-11T00:00:00.000Z");
const PERIOD_TO = Date.parse("2026-08-11T23:59:59.999Z");

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Valida export histórico sin importar. */
export function validateHistoricalExport(filename: string): ValidateResult {
  ensureGovDirs();
  const src = assertDropboxFile(filename);
  if (!existsSync(src)) {
    return {
      ok: false,
      conversation_count: 0,
      message_count: 0,
      accepted_conversations: 0,
      rejected_conversations: 0,
      reject_reasons: ["file_missing"],
      fields_seen: [],
      fields_discarded: [],
      period_effective: { from: null, to: null },
      sha256: "",
      errors: ["dropbox_file_missing"],
    };
  }
  const sha256 = sha256File(src);
  const errors: string[] = [];
  const reject_reasons: string[] = [];
  let obj: HistoricalExport;
  try {
    obj = JSON.parse(readFileSync(src, "utf8")) as HistoricalExport;
  } catch {
    return {
      ok: false,
      conversation_count: 0,
      message_count: 0,
      accepted_conversations: 0,
      rejected_conversations: 0,
      reject_reasons: ["invalid_json"],
      fields_seen: [],
      fields_discarded: [],
      period_effective: { from: null, to: null },
      sha256,
      errors: ["invalid_json"],
    };
  }
  if (obj.synthetic !== false) errors.push("must_set_synthetic_false");
  if (!obj.tenant_id) errors.push("tenant_missing_root");
  if (obj.tenant_id && obj.tenant_id !== "tenant_internal_ops") {
    errors.push("tenant_not_authorized_internal_ops");
  }
  const msgs = obj.messages ?? [];
  if (!Array.isArray(msgs) || msgs.length === 0) errors.push("no_messages");

  const fields_seen = new Set<string>();
  const fields_discarded = new Set<string>();
  const byConv = new Map<string, HistoricalMessage[]>();
  let minTs: number | null = null;
  let maxTs: number | null = null;

  for (const m of msgs) {
    for (const k of Object.keys(m)) {
      fields_seen.add(k);
      if ((DEFAULT_FORBIDDEN_FIELDS as readonly string[]).includes(k)) {
        fields_discarded.add(k);
        errors.push(`forbidden_field:${k}`);
      }
    }
    if (!m.tenant_id) errors.push("message_tenant_missing");
    if (m.tenant_id && obj.tenant_id && m.tenant_id !== obj.tenant_id) {
      errors.push("multi_tenant_forbidden");
    }
    if (!m.conversation_id || m.message_role == null || m.text == null) {
      errors.push("required_message_fields");
    }
    if (m.received_at) {
      const t = Date.parse(m.received_at);
      if (Number.isNaN(t)) errors.push("invalid_timestamp");
      else {
        if (t < PERIOD_FROM || t > PERIOD_TO) {
          // will reject conversation
        } else {
          minTs = minTs == null ? t : Math.min(minTs, t);
          maxTs = maxTs == null ? t : Math.max(maxTs, t);
        }
      }
    }
    const arr = byConv.get(m.conversation_id) ?? [];
    arr.push(m);
    byConv.set(m.conversation_id, arr);
  }

  let accepted = 0;
  let rejected = 0;
  for (const [cid, turns] of byConv) {
    const tenants = new Set(turns.map((t) => t.tenant_id));
    if (tenants.size !== 1) {
      rejected += 1;
      reject_reasons.push(`tenant_mix:${cid}`);
      continue;
    }
    const times = turns
      .map((t) => (t.received_at ? Date.parse(t.received_at) : null))
      .filter((t): t is number => t != null && !Number.isNaN(t));
    if (times.length > 0) {
      const inRange = times.every((t) => t >= PERIOD_FROM && t <= PERIOD_TO);
      if (!inRange) {
        rejected += 1;
        reject_reasons.push(`out_of_period:${cid}`);
        continue;
      }
    }
    accepted += 1;
  }

  const conversation_count = byConv.size;
  if (
    conversation_count < HISTORICAL_VOLUME.min ||
    conversation_count > HISTORICAL_VOLUME.max
  ) {
    errors.push(`volume_out_of_range:${conversation_count}`);
  }
  if (accepted < HISTORICAL_VOLUME.min) {
    errors.push(`accepted_below_min:${accepted}`);
  }

  return {
    ok:
      errors.length === 0 &&
      accepted >= HISTORICAL_VOLUME.min &&
      accepted <= HISTORICAL_VOLUME.max,
    conversation_count,
    message_count: msgs.length,
    accepted_conversations: accepted,
    rejected_conversations: rejected,
    reject_reasons: reject_reasons.slice(0, 50),
    fields_seen: [...fields_seen],
    fields_discarded: [...fields_discarded],
    period_effective: {
      from: minTs ? new Date(minTs).toISOString() : null,
      to: maxTs ? new Date(maxTs).toISOString() : null,
    },
    sha256,
    errors,
  };
}

/** Emite auth ligada al hash y deja el archivo listo para import forzado. */
export function authorizeAndBind(filename: string): {
  auth: HistoricalAuth;
  validation: ValidateResult;
} {
  const validation = validateHistoricalExport(filename);
  if (!validation.ok) {
    throw new Error(`validation_failed:${validation.errors.join(",")}`);
  }
  const existing = loadHistoricalAuthorization();
  let auth: HistoricalAuth;
  if (
    existing &&
    existing.file_sha256 === validation.sha256 &&
    existing.source_filename === filename &&
    existing.status === "authorized"
  ) {
    auth = existing;
  } else {
    auth = issueHistoricalAuthorization({
      sourceFilename: filename,
      fileSha256: validation.sha256,
      conversationCount: validation.accepted_conversations,
    });
  }
  writeFileSync(
    join(GOV_DIRS.reports, `validation-${auth.authorization_id}.json`),
    JSON.stringify(
      {
        ...validation,
        // sin textos
        reject_reasons: validation.reject_reasons,
      },
      null,
      2,
    ),
  );
  return { auth, validation };
}

export function importAuthorizedHistorical(filename: string): ImportManifest {
  const src = assertDropboxFile(filename);
  const sha = sha256File(src);
  assertAuthMatchesFile(sha, filename);
  assertStage9BAuthorized();
  // forceHistorical exige auth 9B
  return importDropboxFile(filename, { forceHistorical: true });
}
