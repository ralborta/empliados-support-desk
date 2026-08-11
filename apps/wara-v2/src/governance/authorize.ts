/**
 * Autorización de datasets históricos (9B) — bloqueada por defecto.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GOV_DIRS, assertInsideGovernance } from "./paths.js";

export type HistoricalAuth = {
  stage: "9B";
  owner: string;
  provenance: string;
  purpose: string;
  companies: string[];
  time_range: { from: string; to: string };
  max_records: number;
  allowed_fields: string[];
  origin_path_label: string;
  local_path_allowed: string;
  retention_days: number;
  approver: string;
  deletion_criteria: string;
  authorized: true;
};

/** Sin este archivo explícito, 9B permanece bloqueada. */
export function loadHistoricalAuthorization(): HistoricalAuth | null {
  const p = join(GOV_DIRS.reports, "HISTORICAL_AUTH.json");
  if (!existsSync(p)) return null;
  assertInsideGovernance(p);
  const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<HistoricalAuth>;
  if (raw.authorized !== true || raw.stage !== "9B") return null;
  const required = [
    "owner",
    "provenance",
    "purpose",
    "approver",
    "retention_days",
    "max_records",
  ] as const;
  for (const k of required) {
    if (raw[k] == null || raw[k] === "") return null;
  }
  return raw as HistoricalAuth;
}

export function assertStage9BAuthorized(): HistoricalAuth {
  const auth = loadHistoricalAuthorization();
  if (!auth) {
    throw new Error("stage_9B_blocked_no_authorization");
  }
  return auth;
}

export function assertStage9AOnly(): void {
  // 9A nunca lee históricos reales; si hay auth presente aún no habilita lectura automática
  void loadHistoricalAuthorization();
}
