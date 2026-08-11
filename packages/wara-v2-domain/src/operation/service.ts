import { createHash, randomUUID } from "node:crypto";
import { V2_DEFAULTS } from "@wara-v2/contracts";
import {
  DomainError,
  InvalidTransitionError,
  InvariantError,
} from "../errors.js";
import { resolveTransition, assertConfirmationCoherence } from "./state-machine.js";
import type { OperationDomainEvent } from "./events.js";
import type { OperationRecord, ConfirmationRecord } from "./types.js";
import type {
  ApplyCommand,
  OperationRepository,
  UnitOfWork,
} from "../ports/operation-repository.js";
import { isTerminalStatus } from "./statuses.js";

export function hashPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Patrón canónico Attempt (Fase 3):
 * - `OperationAttempt` es **write-once** (append-only a nivel DB tras migración incremental).
 * - El inicio del intento se registra en `OperationEvent` (`start_attempt`).
 * - La fila Attempt se inserta solo cuando hay outcome conocido (éxito/fallo/timeout/ambiguous).
 * - Evolución posterior = nuevos eventos append-only y/o reconcile; nunca UPDATE del attempt.
 */
export const ATTEMPT_APPEND_ONLY_POLICY =
  "write_once_attempt_row_plus_operation_events" as const;

function ensureNoSupersedeCycle(
  chain: { id: string; supersedesId: string | null }[],
  newId: string,
  supersedesId: string,
): void {
  const seen = new Set<string>([newId]);
  let current: string | null = supersedesId;
  while (current) {
    if (seen.has(current)) {
      throw new InvariantError("supersede cycle detected", { current });
    }
    seen.add(current);
    const row = chain.find((c) => c.id === current);
    current = row?.supersedesId ?? null;
  }
}

export class OperationDomainService {
  constructor(private readonly uow: UnitOfWork) {}

  async apply(command: ApplyCommand): Promise<{
    operation: OperationRecord;
    superseded?: OperationRecord;
    created?: OperationRecord;
    idempotent: boolean;
  }> {
    return this.uow.transaction(async (repo) => {
      // Idempotencia de comando
      const prior = await repo.findEventByCommandId(command.commandId);
      if (prior) {
        const op = await repo.findById(prior.operationId);
        if (!op) {
          throw new DomainError(
            "IDEMPOTENT_ORPHAN",
            "commandId exists without operation",
          );
        }
        return { operation: op, idempotent: true };
      }

      const now = command.context?.now ?? new Date();
      const mutationsDisabled =
        command.context?.mutationsDisabled ?? true; // default safe

      if (
        command.event === "create" ||
        ((command.event === "prepare_incomplete" ||
          command.event === "prepare_complete") &&
          !command.operationId)
      ) {
        return this.createInitial(repo, command, now, mutationsDisabled);
      }

      if (!command.operationId) {
        throw new InvalidTransitionError("operationId required");
      }

      const op = await repo.findById(command.operationId);
      if (!op) {
        throw new DomainError("NOT_FOUND", "operation not found", {
          id: command.operationId,
        });
      }

      if (isTerminalStatus(op.status) && op.status === "superseded") {
        throw new InvalidTransitionError(
          "superseded operation cannot be reactivated or executed",
          { id: op.id },
        );
      }

      let confirmation: ConfirmationRecord | null = null;
      if (command.confirmationId) {
        confirmation = await repo.getConfirmation(command.confirmationId);
      } else if (op.confirmationId) {
        confirmation = await repo.getConfirmation(op.confirmationId);
      }
      if (command.confirmation) {
        // Will create after transition success for confirm_valid path
      }

      const decision = resolveTransition({
        operation: op,
        event: command.event,
        context: {
          now,
          maxAttempts:
            command.context?.maxAttempts ?? V2_DEFAULTS.OPERATION_MAX_ATTEMPTS,
          confirmation: command.confirmation
            ? {
                id: command.confirmation.id,
                operationId: command.confirmation.operationId,
                operationVersion: command.confirmation.operationVersion,
                payloadHash: command.confirmation.payloadHash,
                confirmationMessageId:
                  command.confirmation.confirmationMessageId,
                actorType: command.confirmation.actorType,
                actorId: command.confirmation.actorId,
                confirmedAt: command.confirmation.confirmedAt,
                expiresAt: command.confirmation.expiresAt,
                status: "valid",
                invalidationReason: null,
              }
            : confirmation,
          expectedPayloadHash: command.context?.expectedPayloadHash,
          expectedOperationVersion: command.context?.expectedOperationVersion,
          executionMode: command.context?.executionMode ?? op.executionMode,
          mutationsDisabled,
          lock: command.context?.lock ?? null,
          claimedOwnerId: command.context?.claimedOwnerId,
          claimedFencingToken: command.context?.claimedFencingToken,
          activeCompanyId: command.context?.activeCompanyId,
          activeUnitId: command.context?.activeUnitId,
          contextRevalidated: command.context?.contextRevalidated,
          reconcileEvidence: command.context?.reconcileEvidence,
          hadCancelRequested: Boolean(op.cancelRequestedAt),
          newPayload: command.supersede?.newPayload,
          newPayloadHash: command.supersede?.newPayloadHash,
          actor: command.actor,
        },
      });

      if (!decision.ok) {
        throw new InvalidTransitionError(decision.message, {
          code: decision.code,
          fromStatus: decision.fromStatus,
          event: decision.event,
        });
      }

      if (decision.idempotent) {
        await repo.appendEvent({
          id: randomUUID(),
          operationId: op.id,
          fromStatus: decision.fromStatus,
          toStatus: decision.toStatus,
          event: command.event,
          actor: command.actor ?? null,
          meta: { idempotent: true },
          commandId: command.commandId,
        });
        return { operation: op, idempotent: true };
      }

      // Supersede path: create new version + link bidirectional in same TX
      if (decision.effects.includes("create_superseding_version")) {
        return this.applySupersede(
          repo,
          op,
          command,
          decision.toStatus,
          decision.fromStatus,
          now,
        );
      }

      let confirmationId = op.confirmationId;
      let boundConfirmation: ConfirmationRecord | null = confirmation;

      if (command.event === "confirm_valid" && command.confirmation) {
        if (command.confirmation.operationId !== op.id) {
          throw new InvariantError(
            "confirmation.operationId must equal operation.id",
          );
        }
        boundConfirmation = await repo.createConfirmation(command.confirmation);
        confirmationId = boundConfirmation.id;
        await repo.bindConfirmation(op.id, boundConfirmation.id);
        assertConfirmationCoherence(
          { ...op, confirmationId },
          boundConfirmation,
        );
      }

      if (
        decision.effects.includes("invalidate_confirmation") &&
        confirmationId
      ) {
        await repo.invalidateConfirmation(
          confirmationId,
          decision.effects.includes("require_reconfirm")
            ? "context_reactivation_requires_reconfirm"
            : `transition:${command.event}`,
        );
        if (
          decision.toStatus === "suspended" ||
          decision.toStatus === "awaiting_confirmation" ||
          decision.toStatus === "cancelled" ||
          decision.toStatus === "expired"
        ) {
          confirmationId = null;
        }
      }

      let attemptId: string | null = null;
      let attemptCount = op.attemptCount;
      if (decision.effects.includes("record_attempt_outcome")) {
        if (command.context?.existingAttemptId) {
          // Write-once pre-HTTP: no mutar fila ni re-incrementar contador canónico.
          attemptId = command.context.existingAttemptId;
        } else if (command.context?.attempt) {
          attemptCount = op.attemptCount + 1;
          const attempt = await repo.createAttempt({
            id: command.context.attempt.id ?? randomUUID(),
            operationId: op.id,
            attemptNo: attemptCount,
            requestHash: command.context.attempt.requestHash,
            fencingToken: command.context.attempt.fencingToken,
            ownerId: command.context.attempt.ownerId,
            outcome: command.context.attempt.outcome,
            startedAt: command.context.attempt.startedAt,
            finishedAt: command.context.attempt.finishedAt,
            externalIdempotencyKey:
              command.context.attempt.externalIdempotencyKey ?? null,
            externalReference: command.context.attempt.externalReference ?? null,
            httpStatus: command.context.attempt.httpStatus ?? null,
            error: command.context.attempt.error ?? null,
            reconciliationStatus:
              command.context.attempt.reconciliationStatus ??
              (decision.toStatus === "unknown_outcome" ? "pending" : "not_needed"),
            reconciliationNotes:
              command.context.attempt.reconciliationNotes ??
              (decision.effects.includes("note_cancel_during_reconcile")
                ? "cancel_requested_during_attempt"
                : null),
          });
          attemptId = attempt.id;
        }
      }

      const updated = await repo.updateStatus({
        id: op.id,
        fromStatus: op.status,
        toStatus: decision.toStatus,
        confirmationId,
        cancelRequestedAt:
          command.event === "user_cancel" ? now : op.cancelRequestedAt,
        queuedAt:
          decision.toStatus === "queued" ? now : op.queuedAt,
        processingAt:
          decision.toStatus === "processing" ? now : op.processingAt,
        finishedAt: ["succeeded", "cancelled", "expired", "permanent_failed"].includes(
          decision.toStatus,
        )
          ? now
          : op.finishedAt,
        attemptCount,
        result: decision.effects.includes("flag_cancel_requested_after_success")
          ? { cancel_requested_after_success: true }
          : undefined,
      });

      await repo.appendEvent({
        id: randomUUID(),
        operationId: op.id,
        fromStatus: decision.fromStatus,
        toStatus: decision.toStatus,
        event: command.event,
        actor: command.actor ?? null,
        meta: {
          effects: decision.effects,
          ...(decision.effects.includes("flag_cancel_requested_after_success")
            ? { cancel_requested_after_success: true }
            : {}),
          ...(decision.effects.includes("mark_needs_human")
            ? { needs_human: true }
            : {}),
        },
        attemptId,
        commandId: command.commandId,
      });

      return { operation: updated, idempotent: false };
    });
  }

  private async createInitial(
    repo: OperationRepository,
    command: ApplyCommand,
    now: Date,
    _mutationsDisabled: boolean,
  ) {
    if (!command.create) {
      throw new InvalidTransitionError("create payload required");
    }
    const existing = await repo.findByIdempotencyKey(
      command.create.idempotencyKey,
    );
    if (existing) {
      await repo.appendEvent({
        id: randomUUID(),
        operationId: existing.id,
        fromStatus: existing.status,
        toStatus: existing.status,
        event: command.event,
        actor: command.actor ?? null,
        meta: { idempotent: true, via: "idempotency_key" },
        commandId: command.commandId,
      });
      return { operation: existing, idempotent: true };
    }

    const decision = resolveTransition({
      operation: null,
      event: command.event,
      context: {
        now,
        maxAttempts: V2_DEFAULTS.OPERATION_MAX_ATTEMPTS,
        mutationsDisabled: true,
        executionMode: command.create.executionMode,
      },
    });
    if (!decision.ok) {
      throw new InvalidTransitionError(decision.message);
    }

    const lineageId = command.create.lineageId ?? randomUUID();
    const id = command.create.id ?? randomUUID();
    const created = await repo.create({
      id,
      lineageId,
      operationVersion: command.create.operationVersion ?? 1,
      type: command.create.type,
      conversationId: command.create.conversationId,
      customerId: command.create.customerId,
      companyId: command.create.companyId,
      unitId: command.create.unitId ?? null,
      payload: command.create.payload,
      payloadHash: command.create.payloadHash,
      idempotencyKey: command.create.idempotencyKey,
      status: decision.toStatus,
      executionMode: command.create.executionMode,
      requiresConfirmation: command.create.requiresConfirmation ?? true,
      expiresAt: command.create.expiresAt ?? null,
    });

    await repo.appendEvent({
      id: randomUUID(),
      operationId: created.id,
      fromStatus: null,
      toStatus: created.status,
      event: command.event,
      actor: command.actor ?? null,
      meta: {},
      commandId: command.commandId,
    });

    return { operation: created, created, idempotent: false };
  }

  private async applySupersede(
    repo: OperationRepository,
    prev: OperationRecord,
    command: ApplyCommand,
    _toStatus: OperationRecord["status"],
    fromStatus: OperationRecord["status"] | null,
    now: Date,
  ) {
    if (!command.supersede) {
      throw new InvalidTransitionError(
        "supersede/correct_payload requires supersede payload",
      );
    }
    if (prev.supersededById) {
      throw new InvariantError("operation already has supersededById");
    }
    if (isTerminalStatus(prev.status) && prev.status === "superseded") {
      throw new InvalidTransitionError("cannot supersede an already superseded op");
    }

    const newId = randomUUID();
    ensureNoSupersedeCycle(
      [{ id: prev.id, supersedesId: prev.supersedesId }],
      newId,
      prev.id,
    );

    // Mark prev superseded first (still active index: superseded is terminal)
    const superseded = await repo.updateStatus({
      id: prev.id,
      fromStatus: prev.status,
      toStatus: "superseded",
      finishedAt: now,
      confirmationId: null,
    });

    if (prev.confirmationId) {
      await repo.invalidateConfirmation(
        prev.confirmationId,
        "superseded_by_new_version",
      );
    }

    const created = await repo.create({
      id: newId,
      lineageId: prev.lineageId,
      operationVersion: prev.operationVersion + 1,
      type: prev.type,
      conversationId: prev.conversationId,
      customerId: prev.customerId,
      companyId: command.supersede.companyId ?? prev.companyId,
      unitId:
        command.supersede.unitId !== undefined
          ? command.supersede.unitId
          : prev.unitId,
      payload: command.supersede.newPayload,
      payloadHash: command.supersede.newPayloadHash,
      idempotencyKey: command.supersede.newIdempotencyKey,
      status: "awaiting_confirmation",
      executionMode: prev.executionMode,
      requiresConfirmation: true,
      supersedesId: prev.id,
    });

    await repo.linkSupersededBy(prev.id, created.id);

    await repo.appendEvent({
      id: randomUUID(),
      operationId: prev.id,
      fromStatus,
      toStatus: "superseded",
      event: command.event,
      actor: command.actor ?? null,
      meta: { superseded_by_id: created.id },
      commandId: command.commandId,
    });
    await repo.appendEvent({
      id: randomUUID(),
      operationId: created.id,
      fromStatus: null,
      toStatus: created.status,
      event: "create",
      actor: command.actor ?? null,
      meta: {
        supersedes_id: prev.id,
        operation_version: created.operationVersion,
      },
      commandId: `${command.commandId}:new`,
    });

    // Reload with links
    const linkedPrev = await repo.findById(prev.id);
    const linkedNew = await repo.findById(created.id);
    if (
      !linkedPrev ||
      !linkedNew ||
      linkedPrev.supersededById !== linkedNew.id ||
      linkedNew.supersedesId !== linkedPrev.id
    ) {
      throw new InvariantError("bidirectional supersede link broken");
    }

    return {
      operation: linkedPrev,
      superseded: linkedPrev,
      created: linkedNew,
      idempotent: false,
    };
  }
}

export function assertCanExecute(op: OperationRecord): void {
  if (op.status === "superseded" || op.supersededById) {
    throw new InvalidTransitionError(
      "superseded operation cannot be executed",
    );
  }
  if (isTerminalStatus(op.status)) {
    throw new InvalidTransitionError("terminal operation cannot be executed");
  }
  if (op.status === "suspended") {
    throw new InvalidTransitionError(
      "suspended operation cannot commit until context_compatible",
    );
  }
}
