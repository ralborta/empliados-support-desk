/**
 * Autorización Fase 9B — vinculada al hash del archivo recibido.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { GOV_DIRS, assertInsideGovernance, ensureGovDirs } from "./paths.js";

export const HISTORICAL_VOLUME = { min: 12, max: 300 } as const;
export const HISTORICAL_AUTH_FILENAME = "HISTORICAL_AUTH.json";

export type HistoricalAuth = {
  stage: "9B";
  authorization_id: string;
  authorized: true;
  owner: string;
  approver: string;
  origin_system: string;
  tenant_authorized: string;
  purpose: string;
  period: { from: string; to: string };
  volume: { min: number; max: number };
  allowed_fields: string[];
  forbidden_fields: string[];
  imported_at: string;
  expires_at: string;
  retention_days: 30;
  file_sha256: string;
  source_filename: string;
  status: "authorized" | "revoked" | "expired";
  provenance: string;
  companies: string[];
  local_path_allowed: string;
  deletion_criteria: string;
};

export const DEFAULT_ALLOWED_FIELDS = [
  "conversation_id",
  "received_at",
  "message_role",
  "text",
  "tenant_id",
  "turn_index",
  "golden_expected",
] as const;

export const DEFAULT_FORBIDDEN_FIELDS = [
  "full_name",
  "phone",
  "email",
  "document_id",
  "plate",
  "vin",
  "address",
  "coordinates",
  "customer_name",
  "employee_name",
  "internal_id",
  "password",
  "token",
  "api_key",
  "private_url",
  "attachment",
  "image",
  "audio",
] as const;

export function historicalAuthPath(): string {
  return join(GOV_DIRS.reports, HISTORICAL_AUTH_FILENAME);
}

export function loadHistoricalAuthorization(): HistoricalAuth | null {
  const p = historicalAuthPath();
  if (!existsSync(p)) return null;
  assertInsideGovernance(p);
  const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<HistoricalAuth>;
  if (raw.authorized !== true || raw.stage !== "9B") return null;
  if (raw.status === "revoked") return null;
  if (raw.expires_at && Date.parse(raw.expires_at) < Date.now()) {
    return null;
  }
  const required: Array<keyof HistoricalAuth> = [
    "authorization_id",
    "owner",
    "approver",
    "origin_system",
    "tenant_authorized",
    "purpose",
    "file_sha256",
    "retention_days",
  ];
  for (const k of required) {
    if (raw[k] == null || raw[k] === "") return null;
  }
  return raw as HistoricalAuth;
}

export function assertStage9BAuthorized(): HistoricalAuth {
  const auth = loadHistoricalAuthorization();
  if (!auth) throw new Error("stage_9B_blocked_no_authorization");
  return auth;
}

export function assertStage9AOnly(): void {
  void loadHistoricalAuthorization();
}

export function assertAuthMatchesFile(sha256: string, filename: string): HistoricalAuth {
  const auth = assertStage9BAuthorized();
  if (auth.file_sha256 !== sha256) {
    throw new Error("authorization_hash_mismatch");
  }
  if (auth.source_filename !== filename) {
    throw new Error("authorization_filename_mismatch");
  }
  return auth;
}

/**
 * Emite HISTORICAL_AUTH.json ligado al hash del archivo ya depositado.
 * Cualquier cambio del archivo exige nueva autorización.
 */
export function issueHistoricalAuthorization(input: {
  sourceFilename: string;
  fileSha256: string;
  conversationCount: number;
}): HistoricalAuth {
  ensureGovDirs();
  if (
    input.conversationCount < HISTORICAL_VOLUME.min ||
    input.conversationCount > HISTORICAL_VOLUME.max
  ) {
    throw new Error(
      `volume_out_of_range:${input.conversationCount};expected_${HISTORICAL_VOLUME.min}_${HISTORICAL_VOLUME.max}`,
    );
  }
  const importedAt = new Date();
  const expires = new Date(importedAt.getTime() + 30 * 24 * 3600 * 1000);
  const auth: HistoricalAuth = {
    stage: "9B",
    authorization_id: `auth9b_${randomUUID()}`,
    authorized: true,
    owner: "Empliados / operación interna",
    approver: "Raúl Alborta",
    origin_system: "railway_soporte_ticketmessage_readonly",
    tenant_authorized: "tenant_internal_ops",
    purpose:
      "anonimización, benchmark y evaluación offline WARA V2 (sin entrenamiento)",
    period: {
      from: "2026-05-11T00:00:00.000Z",
      to: "2026-08-11T23:59:59.999Z",
    },
    volume: { min: HISTORICAL_VOLUME.min, max: HISTORICAL_VOLUME.max },
    allowed_fields: [...DEFAULT_ALLOWED_FIELDS],
    forbidden_fields: [...DEFAULT_FORBIDDEN_FIELDS],
    imported_at: importedAt.toISOString(),
    expires_at: expires.toISOString(),
    retention_days: 30,
    file_sha256: input.fileSha256,
    source_filename: input.sourceFilename,
    status: "authorized",
    provenance: "railway_soporte_export_autorizado_volumen_reducido_12_300",
    companies: ["operacion_interna"],
    local_path_allowed: GOV_DIRS.drop,
    deletion_criteria:
      "al vencer 30 días o al cerrar evaluación: revoke + purge dry-run + delete",
  };
  const p = historicalAuthPath();
  writeFileSync(p, JSON.stringify(auth, null, 2));
  return auth;
}

export function revokeHistoricalAuthorization(): void {
  const auth = loadHistoricalAuthorization();
  if (!auth) return;
  auth.status = "revoked";
  writeFileSync(historicalAuthPath(), JSON.stringify(auth, null, 2));
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
