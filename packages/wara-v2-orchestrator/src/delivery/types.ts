import type { ExecutionMode, GoalId } from "@wara-v2/contracts";
import type { OperationRecord, ConfirmationRecord } from "@wara-v2/domain";
import { isTerminalStatus } from "@wara-v2/domain";
import type { FeatureFlags } from "../types.js";

export type DeliveryGateCheckKey =
  | "feature_flags"
  | "execution_mode"
  | "operation_type"
  | "operation_status"
  | "confirmation_valid"
  | "version_current"
  | "payload_hash"
  | "company_unit"
  | "tool_authorized"
  | "idempotency"
  | "lease_fence"
  | "not_superseded"
  | "not_suspended"
  | "not_expired"
  | "not_cancelled"
  | "mutation_policy";

export type DeliveryGateRequest = {
  intent: "outbound_message" | "external_mutation" | "simulate";
  executionMode: ExecutionMode;
  featureFlags: FeatureFlags;
  mutationsDisabled: boolean;
  toolName?: string;
  operation?: OperationRecord | null;
  confirmation?: ConfirmationRecord | null;
  expectedPayloadHash?: string;
  expectedOperationVersion?: number;
  activeCompanyId?: string | null;
  activeUnitId?: string | null;
  proposedCompanyId?: string | null;
  proposedUnitId?: string | null;
  idempotencyKey?: string;
  seenIdempotencyKeys?: Set<string>;
  lock?: {
    ownerId: string;
    fencingToken: bigint;
    leaseExpiresAt: Date;
  } | null;
  claimedOwnerId?: string;
  claimedFencingToken?: bigint;
  now: Date;
  /** Tools authorized by Policy for this turn. */
  allowToolCalls: string[];
};

export type DeliveryGateResult = {
  /** Nunca true para efecto externo real en Fase 4. */
  allowExternalEffect: false;
  outcome: "simulated" | "suppressed" | "denied";
  reasons: string[];
  checks: Record<DeliveryGateCheckKey, boolean>;
  wouldAllowIfMutationsEnabled: boolean;
};

const COMMIT_TOOLS = new Set([
  "commit_odometer_update",
  "commit_certificate",
  "commit_maintenance",
  "commit_odoo_ticket",
]);

/**
 * DeliveryGate — deny-by-default.
 * En Fase 4, aunque todos los checks pasen, el resultado es simulación/supresión.
 */
export function evaluateDeliveryGate(
  req: DeliveryGateRequest,
): DeliveryGateResult {
  const checks: Record<DeliveryGateCheckKey, boolean> = {
    feature_flags: false,
    execution_mode: false,
    operation_type: false,
    operation_status: false,
    confirmation_valid: false,
    version_current: false,
    payload_hash: false,
    company_unit: false,
    tool_authorized: false,
    idempotency: false,
    lease_fence: false,
    not_superseded: false,
    not_suspended: false,
    not_expired: false,
    not_cancelled: false,
    mutation_policy: false,
  };
  const reasons: string[] = [];

  checks.feature_flags = req.featureFlags.enabled === true;
  if (!checks.feature_flags) reasons.push("feature_flags_disabled");

  checks.execution_mode = ["dry_run", "simulation", "shadow", "pilot", "production"].includes(
    req.executionMode,
  );
  if (!checks.execution_mode) reasons.push("invalid_execution_mode");

  // Modos no-prod: never real channel send
  if (
    req.intent === "outbound_message" &&
    (req.executionMode === "dry_run" ||
      req.executionMode === "simulation" ||
      req.executionMode === "shadow" ||
      !req.featureFlags.allowWhatsAppSend)
  ) {
    reasons.push("outbound_suppressed_non_prod_or_flag");
  }

  checks.mutation_policy =
    req.mutationsDisabled === true
      ? req.intent !== "external_mutation" || req.executionMode === "dry_run"
      : false;
  // Con mutations disabled, external_mutation nunca pasa como "real".
  // intent=simulate (simulador local Fase 5/6) sí puede pasar mutation_policy.
  if (req.mutationsDisabled) {
    if (req.intent === "simulate") {
      checks.mutation_policy = true;
    } else {
      checks.mutation_policy = false;
      reasons.push("V2_MUTATIONS_DISABLED");
    }
  }

  if (req.toolName) {
    checks.tool_authorized = req.allowToolCalls.includes(req.toolName);
    if (!checks.tool_authorized) reasons.push(`tool_not_authorized:${req.toolName}`);
    if (
      COMMIT_TOOLS.has(req.toolName) &&
      req.mutationsDisabled &&
      req.intent !== "simulate"
    ) {
      checks.mutation_policy = false;
      reasons.push("commit_blocked_mutations_disabled");
    }
  } else {
    checks.tool_authorized = true;
  }

  if (req.idempotencyKey && req.seenIdempotencyKeys?.has(req.idempotencyKey)) {
    checks.idempotency = false;
    reasons.push("duplicate_idempotency_key");
  } else {
    checks.idempotency = true;
  }

  const op = req.operation;
  if (op) {
    checks.operation_type = Boolean(op.type);
    checks.operation_status = !isTerminalStatus(op.status) || op.status === "confirmed";
    // For commit path, need confirmed or queued
    if (req.toolName && COMMIT_TOOLS.has(req.toolName)) {
      checks.operation_status = op.status === "confirmed" || op.status === "queued";
      if (!checks.operation_status) {
        reasons.push(`invalid_status_for_commit:${op.status}`);
      }
    }

    checks.not_superseded = !op.supersededById && op.status !== "superseded";
    if (!checks.not_superseded) reasons.push("operation_superseded");

    checks.not_suspended = op.status !== "suspended";
    if (!checks.not_suspended) reasons.push("operation_suspended");

    checks.not_expired = op.status !== "expired";
    if (!checks.not_expired) reasons.push("operation_expired");

    checks.not_cancelled = op.status !== "cancelled" && op.status !== "cancel_requested";
    if (!checks.not_cancelled) reasons.push("operation_cancelled");

    if (req.expectedOperationVersion !== undefined) {
      checks.version_current = op.operationVersion === req.expectedOperationVersion;
      if (!checks.version_current) reasons.push("operation_version_mismatch");
    } else {
      checks.version_current = true;
    }

    if (req.expectedPayloadHash) {
      checks.payload_hash = op.payloadHash === req.expectedPayloadHash;
      if (!checks.payload_hash) reasons.push("payload_hash_mismatch");
    } else {
      checks.payload_hash = true;
    }

    const companyOk =
      !req.activeCompanyId ||
      !req.proposedCompanyId ||
      req.activeCompanyId === req.proposedCompanyId ||
      req.activeCompanyId === op.companyId;
    const unitOk =
      !req.activeUnitId ||
      !op.unitId ||
      !req.proposedUnitId ||
      req.activeUnitId === op.unitId;
    // Multiempresa: op.companyId must match active when set
    const isolationOk =
      !req.activeCompanyId || op.companyId === req.activeCompanyId;
    checks.company_unit = Boolean(companyOk && unitOk && isolationOk);
    if (!checks.company_unit) reasons.push("company_unit_isolation");

    if (COMMIT_TOOLS.has(req.toolName ?? "") && req.intent !== "simulate") {
      const c = req.confirmation;
      checks.confirmation_valid = Boolean(
        c &&
          c.status === "valid" &&
          c.operationId === op.id &&
          c.operationVersion === op.operationVersion &&
          c.payloadHash === op.payloadHash &&
          c.expiresAt.getTime() > req.now.getTime() &&
          op.confirmationId === c.id,
      );
      if (!checks.confirmation_valid) reasons.push("confirmation_invalid_or_missing");
    } else {
      checks.confirmation_valid = true;
    }
  } else {
    checks.operation_type = true;
    checks.operation_status = true;
    checks.not_superseded = true;
    checks.not_suspended = true;
    checks.not_expired = true;
    checks.not_cancelled = true;
    checks.version_current = true;
    checks.payload_hash = true;
    checks.company_unit = true;
    checks.confirmation_valid = true;
  }

  if (req.intent === "external_mutation" || (req.toolName && COMMIT_TOOLS.has(req.toolName))) {
    const lock = req.lock;
    checks.lease_fence = Boolean(
      lock &&
        lock.leaseExpiresAt.getTime() > req.now.getTime() &&
        (!req.claimedOwnerId || lock.ownerId === req.claimedOwnerId) &&
        (req.claimedFencingToken === undefined ||
          lock.fencingToken === req.claimedFencingToken),
    );
    if (!checks.lease_fence) reasons.push("lease_or_fence_invalid");
  } else {
    checks.lease_fence = true;
  }

  const allCriticalPass = Object.values(checks).every(Boolean);
  // Fase 4: nunca allowExternalEffect
  if (req.executionMode === "dry_run" || req.executionMode === "simulation") {
    return {
      allowExternalEffect: false,
      outcome: allCriticalPass && req.intent !== "external_mutation"
        ? "simulated"
        : req.mutationsDisabled
          ? "denied"
          : "suppressed",
      reasons: reasons.length
        ? reasons
        : ["dry_run_simulation_only"],
      checks,
      wouldAllowIfMutationsEnabled: allCriticalPass && !req.mutationsDisabled,
    };
  }

  return {
    allowExternalEffect: false,
    outcome: "denied",
    reasons: [...reasons, "phase4_no_external_effects"],
    checks,
    wouldAllowIfMutationsEnabled: allCriticalPass,
  };
}

export function goalAllowed(flags: FeatureFlags, goal: GoalId): boolean {
  return flags.allowedGoals.includes(goal);
}
