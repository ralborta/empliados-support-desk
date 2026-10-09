import type { OperationStatus } from "@wara-v2/contracts";
import { V2_DEFAULTS } from "@wara-v2/contracts";
import { GuardFailedError } from "../errors.js";
import type { OperationDomainEvent } from "./events.js";
import {
  isSupersedeForbidden,
  isTerminalStatus,
} from "./statuses.js";
import { TRANSITION_TABLE } from "./transition-table.js";
import type {
  TransitionContext,
  TransitionResult,
  OperationRecord,
  ConfirmationRecord,
} from "./types.js";

function findRules(
  from: OperationStatus | null,
  event: OperationDomainEvent,
) {
  return TRANSITION_TABLE.filter((r) => r.from === from && r.event === event);
}

export function evaluateGuards(
  guard: NonNullable<(typeof TRANSITION_TABLE)[number]["guard"]>,
  op: OperationRecord | null,
  ctx: TransitionContext,
): void {
  switch (guard) {
    case "binding_match": {
      const c = ctx.confirmation;
      if (!op) throw new GuardFailedError("operation required for binding_match");
      if (!c) throw new GuardFailedError("confirmation binding required");
      if (c.operationId !== op.id) {
        throw new GuardFailedError("confirmation.operationId mismatch", {
          confirmationOperationId: c.operationId,
          operationId: op.id,
        });
      }
      if (c.operationVersion !== op.operationVersion) {
        throw new GuardFailedError("confirmation.operationVersion mismatch");
      }
      if (c.payloadHash !== op.payloadHash) {
        throw new GuardFailedError("confirmation.payloadHash mismatch");
      }
      if (c.status !== "valid") {
        throw new GuardFailedError("confirmation not valid", {
          status: c.status,
        });
      }
      if (c.expiresAt.getTime() <= ctx.now.getTime()) {
        throw new GuardFailedError("confirmation expired");
      }
      if (
        ctx.expectedPayloadHash &&
        ctx.expectedPayloadHash !== op.payloadHash
      ) {
        throw new GuardFailedError("expectedPayloadHash mismatch");
      }
      if (
        ctx.expectedOperationVersion !== undefined &&
        ctx.expectedOperationVersion !== op.operationVersion
      ) {
        throw new GuardFailedError("expectedOperationVersion mismatch");
      }
      return;
    }
    case "mode_ok": {
      const mode = ctx.executionMode ?? op?.executionMode ?? "dry_run";
      if (ctx.mutationsDisabled === true && mode === "production") {
        throw new GuardFailedError(
          "mutations disabled: cannot enqueue production commit",
        );
      }
      // Fase 3: enqueue permitido en dry_run/simulation/shadow/pilot sin HTTP.
      return;
    }
    case "lock_fence": {
      const lock = ctx.lock;
      if (!lock) throw new GuardFailedError("conversation lock required");
      if (lock.leaseExpiresAt.getTime() <= ctx.now.getTime()) {
        throw new GuardFailedError("lock lease expired");
      }
      if (
        ctx.claimedOwnerId &&
        lock.ownerId !== ctx.claimedOwnerId
      ) {
        throw new GuardFailedError("lock owner mismatch");
      }
      if (
        ctx.claimedFencingToken !== undefined &&
        lock.fencingToken !== ctx.claimedFencingToken
      ) {
        throw new GuardFailedError("fencing_token mismatch");
      }
      return;
    }
    case "attempts_lt_max": {
      const max = ctx.maxAttempts ?? V2_DEFAULTS.OPERATION_MAX_ATTEMPTS;
      const count = op?.attemptCount ?? 0;
      if (count >= max) {
        throw new GuardFailedError("max attempts exceeded", { count, max });
      }
      return;
    }
    case "context_revalidated": {
      if (!ctx.contextRevalidated) {
        throw new GuardFailedError(
          "context_compatible requires explicit context revalidation",
        );
      }
      if (op && ctx.activeCompanyId && ctx.activeCompanyId !== op.companyId) {
        throw new GuardFailedError("activeCompanyId still incompatible");
      }
      if (
        op?.unitId &&
        ctx.activeUnitId &&
        ctx.activeUnitId !== op.unitId
      ) {
        throw new GuardFailedError("activeUnitId still incompatible");
      }
      return;
    }
    case "evidence_success": {
      if (ctx.reconcileEvidence !== "success") {
        throw new GuardFailedError("reconcile success evidence required");
      }
      return;
    }
    case "evidence_absent": {
      if (ctx.reconcileEvidence !== "absent") {
        throw new GuardFailedError("reconcile absent evidence required");
      }
      return;
    }
    case "not_terminal": {
      if (op && isTerminalStatus(op.status)) {
        throw new GuardFailedError("operation is terminal");
      }
      return;
    }
    case "payload_version_current": {
      if (!op) return;
      if (
        ctx.expectedPayloadHash &&
        ctx.expectedPayloadHash !== op.payloadHash
      ) {
        throw new GuardFailedError("payload_hash not current");
      }
      if (
        ctx.expectedOperationVersion !== undefined &&
        ctx.expectedOperationVersion !== op.operationVersion
      ) {
        throw new GuardFailedError("operation_version not current");
      }
      if (isTerminalStatus(op.status) || op.status === "superseded") {
        throw new GuardFailedError("cannot execute non-current/terminal op");
      }
      if (op.supersededById) {
        throw new GuardFailedError("operation already superseded");
      }
      return;
    }
    default: {
      const _exhaustive: never = guard;
      throw new GuardFailedError(`unknown guard: ${_exhaustive}`);
    }
  }
}

/**
 * Resuelve una transición sin efectos colaterales.
 * Transición inválida → ok:false (sin throw), para que el servicio no mute.
 */
export function resolveTransition(input: {
  operation: OperationRecord | null;
  event: OperationDomainEvent;
  context: TransitionContext;
}): TransitionResult {
  const fromStatus = input.operation?.status ?? null;
  const { event, context } = input;

  if (input.operation && isTerminalStatus(input.operation.status)) {
    return {
      ok: false,
      code: "TERMINAL_STATE",
      message: `terminal status ${input.operation.status}: transitions forbidden`,
      fromStatus,
      event,
    };
  }

  if (
    input.operation &&
    (event === "supersede" ||
      event === "correct_payload" ||
      event === "context_incompatible") &&
    isSupersedeForbidden(input.operation.status)
  ) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `${event} prohibited from ${input.operation.status} (human/reconcile)`,
      fromStatus,
      event,
    };
  }

  // Idempotencia: mismo evento si ya estamos en el único destino posible.
  const rules = findRules(fromStatus, event);
  if (rules.length === 0) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `no transition for ${fromStatus ?? "∅"} + ${event}`,
      fromStatus,
      event,
    };
  }

  const rule = rules[0]!;

  try {
    if (rule.guard) {
      evaluateGuards(rule.guard, input.operation, context);
    }
    // Pre-ejecución: payload/version vigentes cuando se inicia attempt.
    if (event === "start_attempt" || event === "enqueue_commit") {
      evaluateGuards("payload_version_current", input.operation, {
        ...context,
        expectedPayloadHash:
          context.expectedPayloadHash ?? input.operation?.payloadHash,
        expectedOperationVersion:
          context.expectedOperationVersion ??
          input.operation?.operationVersion,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "GUARD_FAILED",
      message,
      fromStatus,
      event,
    };
  }

  let toStatus = rule.to;
  if (rule.toResolver === "reconcile_absent") {
    toStatus =
      context.hadCancelRequested || input.operation?.cancelRequestedAt
        ? "cancelled"
        : "retryable_failed";
  }

  // Idempotent no-op if already at destination with same event replay.
  if (input.operation?.status === toStatus) {
    return {
      ok: true,
      fromStatus,
      toStatus,
      event,
      effects: [],
      idempotent: true,
    };
  }

  return {
    ok: true,
    fromStatus,
    toStatus,
    event,
    effects: [...(rule.effects ?? [])],
    idempotent: false,
  };
}

export function assertConfirmationCoherence(
  op: OperationRecord,
  confirmation: ConfirmationRecord | null,
): void {
  if (!op.confirmationId) {
    if (confirmation) {
      throw new GuardFailedError(
        "orphan confirmation while operation.confirmationId is null",
      );
    }
    return;
  }
  if (!confirmation || confirmation.id !== op.confirmationId) {
    throw new GuardFailedError(
      "operation.confirmationId must reference loaded confirmation",
    );
  }
  if (confirmation.operationId !== op.id) {
    throw new GuardFailedError(
      "1:1 broken: confirmation.operationId !== operation.id",
    );
  }
}
