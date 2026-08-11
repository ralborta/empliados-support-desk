import { randomUUID, createHash } from "node:crypto";
import {
  parseOrchestratorDecision,
  MODEL_CANNOT_ORDER_COMMIT,
  PG_SOLE_LOCK_AUTHORITY,
  type PolicyDecision,
  type OrchestratorDecision,
  type TurnOutcome,
} from "@wara-v2/contracts";
import {
  OperationDomainService,
  hashPayload,
  type OperationRecord,
  type ApplyCommand,
} from "@wara-v2/domain";
import { V2_MUTATIONS_DISABLED } from "@wara-v2/db";
import { assertPhase4Guarantees } from "../guarantees.js";
import { buildTurnContext, routeIntent } from "../context/build-context.js";
import { buildPolicyDecision, assertNoModelOrderedCommit } from "../policy/engine.js";
import { evaluateDeliveryGate } from "../delivery/gate.js";
import type { DeliveryGateResult } from "../delivery/types.js";
import { composeResponse } from "../composer/response.js";
import { executeStubTool, assertNoExternalSideEffects } from "../tools/stub-executor.js";
import type { ModelAdapter } from "../model/adapters.js";
import type {
  FeatureFlags,
  TraceEvent,
  TurnPipelineInput,
  TurnPipelineResult,
} from "../types.js";
import { DEFAULT_FEATURE_FLAGS } from "../types.js";
import type {
  IngressPort,
  LockPort,
  OperationPort,
  OutboxPort,
  TurnStore,
} from "../persistence/ports.js";

export type TurnPipelineDeps = {
  model: ModelAdapter;
  turns: TurnStore;
  locks: LockPort;
  ingress: IngressPort;
  outbox: OutboxPort;
  operations?: OperationPort;
  domain: OperationDomainService;
  /** Mutable list used when no OperationPort — tests seed here. */
  activeOperationsBag?: OperationRecord[];
  mutationsDisabled?: boolean;
};

/**
 * Pipeline determinístico del turno (Fase 4).
 * Modelo propone → validación → Policy → Domain → DeliveryGate → Outbox suppressed.
 */
export class TurnPipeline {
  constructor(private readonly deps: TurnPipelineDeps) {
    assertPhase4Guarantees();
  }

  async handle(input: TurnPipelineInput): Promise<TurnPipelineResult> {
    void MODEL_CANNOT_ORDER_COMMIT;
    void PG_SOLE_LOCK_AUTHORITY;
    const traces: TraceEvent[] = [];
    const trace = (event: string, meta?: Record<string, unknown>) => {
      traces.push({ at: new Date().toISOString(), event, meta });
    };

    const mutationsDisabled = this.deps.mutationsDisabled ?? V2_MUTATIONS_DISABLED;
    const featureFlags: FeatureFlags =
      input.featureFlags ?? DEFAULT_FEATURE_FLAGS;
    const executionMode = input.executionMode ?? "dry_run";
    const ownerId = input.ownerId ?? `worker_${randomUUID().slice(0, 8)}`;
    const turnId = randomUUID();

    // 1) Idempotencia de comando/turno
    const existing = await this.deps.turns.findByIdempotencyKey(input.commandId);
    if (existing) {
      trace("idempotent_turn", { turnId: existing.id });
      return {
        turnId: existing.id,
        outcome: existing.outcome,
        commandId: input.commandId,
        idempotent: true,
        decision: (existing.decision as OrchestratorDecision) ?? null,
        policy: (existing.policy as PolicyDecision) ?? null,
        delivery: null,
        responseText: "idempotent_replay",
        operationIds: [],
        traces,
      };
    }

    // 2) Ingress dedupe
    const ingress = await this.deps.ingress.accept({
      provider: input.inbound.provider,
      channelAccountId: input.inbound.channelAccountId,
      externalMessageId: input.inbound.messageId,
      conversationId: input.conversation.conversationId,
      payloadHash: input.inbound.payloadHash,
    });
    trace("ingress", { result: ingress });
    if (ingress === "duplicate") {
      return this.finish({
        turnId,
        input,
        outcome: "deduped",
        decision: null,
        policy: null,
        delivery: null,
        responseText: "Mensaje duplicado (idempotente).",
        operationIds: [],
        traces,
        ownerId,
        lock: null,
        executionMode,
      });
    }
    if (ingress === "duplicate_conflict") {
      return this.finish({
        turnId,
        input,
        outcome: "duplicate_conflict",
        decision: null,
        policy: null,
        delivery: null,
        responseText: "Conflicto de payload para el mismo messageId.",
        operationIds: [],
        traces,
        ownerId,
        lock: null,
        executionMode,
        rejection: {
          code: "duplicate_conflict",
          message: "same externalMessageId, different payloadHash",
        },
      });
    }

    // 3) Lock PG-authority (in-memory port simula acquire atómico)
    const lock = await this.deps.locks.acquire(
      input.conversation.conversationId,
      ownerId,
    );
    if (!lock) {
      trace("lock_failed");
      return this.finish({
        turnId,
        input,
        outcome: "failed_lock",
        decision: null,
        policy: null,
        delivery: null,
        responseText: "Otro worker procesa esta conversación. Reintentá.",
        operationIds: [],
        traces,
        ownerId,
        lock: null,
        executionMode,
        rejection: { code: "failed_lock", message: "acquire returned empty" },
      });
    }
    trace("lock_acquired", {
      fencingToken: String(lock.fencingToken),
      ownerId: lock.ownerId,
    });

    try {
      const activeOps =
        input.activeOperations ??
        (await this.deps.operations?.listActive(
          input.conversation.conversationId,
        )) ??
        this.deps.activeOperationsBag ??
        [];

      const context = buildTurnContext({
        conversation: input.conversation,
        inbound: input.inbound,
        activeOperations: activeOps,
        pendingConfirmationOperationId: input.pendingConfirmationOperationId,
        stateVersion: input.stateVersion,
        executionMode,
        featureFlags,
        now: input.now,
      });

      // 4) Modelo
      let raw: unknown;
      try {
        raw = await this.deps.model.decide(context);
        trace("model_decide_ok", { adapter: this.deps.model.name });
      } catch (err) {
        trace("model_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return this.finish({
          turnId,
          input,
          outcome: "failed_model_timeout",
          decision: null,
          policy: null,
          delivery: null,
          responseText:
            "El asistente no está disponible ahora. Intentá de nuevo en unos minutos.",
          operationIds: [],
          traces,
          ownerId,
          lock,
          executionMode,
          rejection: {
            code: "model_unavailable",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }

      // 5) Rechazo explícito si el modelo ordena commit
      const commitLeak = assertNoModelOrderedCommit(raw);
      if (commitLeak) {
        trace("reject_model_commit", { code: commitLeak });
        return this.finish({
          turnId,
          input,
          outcome: "invalid_model_output",
          decision: null,
          policy: null,
          delivery: null,
          responseText: "Decisión inválida: el modelo no puede ordenar commit.",
          operationIds: [],
          traces,
          ownerId,
          lock,
          executionMode,
          rejection: {
            code: commitLeak,
            message: "MODEL_CANNOT_ORDER_COMMIT",
            details: { rawType: typeof raw },
          },
        });
      }

      if (typeof raw === "string") {
        trace("invalid_json_string");
        return this.finish({
          turnId,
          input,
          outcome: "invalid_model_output",
          decision: null,
          policy: null,
          delivery: null,
          responseText: "No pude interpretar la respuesta del modelo.",
          operationIds: [],
          traces,
          ownerId,
          lock,
          executionMode,
          rejection: { code: "invalid_json", message: "model returned non-object" },
        });
      }

      const parsed = parseOrchestratorDecision(raw);
      if (!parsed.ok) {
        trace("schema_invalid", { issues: parsed.issues });
        return this.finish({
          turnId,
          input,
          outcome: "invalid_model_output",
          decision: null,
          policy: null,
          delivery: null,
          responseText: "Decisión estructurada inválida. ¿Podés reformular?",
          operationIds: [],
          traces,
          ownerId,
          lock,
          executionMode,
          rejection: {
            code: "schema_invalid",
            message: parsed.issues.map((i) => i.message).join("; "),
            details: { issues: parsed.issues },
          },
        });
      }

      const decision = parsed.data;
      const routed = routeIntent({ decision, context });
      trace("intent_routed", routed);

      // 6) Policy
      const policy = buildPolicyDecision({
        decision,
        context,
        activeOperations: activeOps,
      });
      trace("policy_built", {
        steps: policy.plan.length,
        allowToolCalls: policy.allowToolCalls,
        blockReasons: policy.blockReasons,
      });

      // 7) Ejecutar plan vía dominio + stubs (sin HTTP)
      const operationIds: string[] = [];
      let lastDelivery: DeliveryGateResult | null = null;
      const bag = this.deps.activeOperationsBag;

      let preparedThisTurn = false;
      for (const step of policy.plan) {
        assertNoExternalSideEffects(step.tool_args ?? {});

        if (step.action === "clarify" || step.action === "escalate_human") {
          continue;
        }

        if (step.action === "call_tool" && step.tool_name) {
          const args = {
            ...(step.tool_args ?? {}),
          } as Record<string, unknown>;
          if (args.value_number != null && args.value == null) {
            args.value = args.value_number;
          }

          const stub = executeStubTool(step.tool_name, args);
          trace("stub_tool", {
            tool: step.tool_name,
            status: stub.status,
          });

          if (
            String(step.tool_name).startsWith("prepare_") &&
            !preparedThisTurn &&
            (stub.status === "needs_confirmation" || stub.status === "simulated")
          ) {
            const payload = {
              company_id: String(
                args.company_id ?? input.conversation.activeCompanyId ?? "",
              ),
              unit_id: String(
                args.unit_id ?? input.conversation.activeUnitId ?? "",
              ),
              value: Number(args.value ?? args.value_number ?? 0),
              unit_label: args.unit_label ? String(args.unit_label) : undefined,
            };
            if (!payload.company_id || (!payload.unit_id && step.tool_name !== "prepare_odoo_ticket")) {
              trace("prepare_incomplete_data", { missing: stub.missing_fields });
              continue;
            }
            if (
              step.tool_name === "prepare_odometer_update" &&
              !(payload.value > 0)
            ) {
              continue;
            }
            const created = await this.deps.domain.apply({
              commandId: `${input.commandId}:op:${step.step_id}`,
              event: "prepare_complete",
              create: {
                type: "update_odometer",
                conversationId: input.conversation.conversationId,
                customerId: input.conversation.customerId,
                companyId: payload.company_id,
                unitId: payload.unit_id,
                payload,
                payloadHash: hashPayload(payload),
                idempotencyKey: `${input.commandId}:${step.step_id}`,
                executionMode: "dry_run",
              },
            });
            operationIds.push(created.operation.id);
            if (bag && bag !== activeOps) bag.push(created.operation);
            activeOps.push(created.operation);
            preparedThisTurn = true;
            trace("operation_created", {
              id: created.operation.id,
              status: created.operation.status,
            });
          }

          if (String(step.tool_name).startsWith("commit_")) {
            const opId = String(step.tool_args?.operation_id ?? "");
            const opRecord =
              activeOps.find((o) => o.id === opId) ??
              bag?.find((o) => o.id === opId) ??
              null;

            lastDelivery = evaluateDeliveryGate({
              intent: "external_mutation",
              executionMode,
              featureFlags,
              mutationsDisabled: true,
              toolName: step.tool_name,
              operation: opRecord,
              confirmation: null,
              expectedPayloadHash: opRecord?.payloadHash,
              expectedOperationVersion: opRecord?.operationVersion,
              activeCompanyId: input.conversation.activeCompanyId,
              activeUnitId: input.conversation.activeUnitId,
              allowToolCalls: policy.allowToolCalls,
              lock,
              claimedOwnerId: lock.ownerId,
              claimedFencingToken: lock.fencingToken,
              now: context.now,
            });
            trace("delivery_gate_commit", lastDelivery);
            if (opRecord && opRecord.status === "confirmed") {
              try {
                const queued = await this.deps.domain.apply({
                  commandId: `${input.commandId}:enqueue:${step.step_id}`,
                  event: "enqueue_commit",
                  operationId: opRecord.id,
                  context: {
                    mutationsDisabled: true,
                    executionMode: "dry_run",
                    expectedPayloadHash: opRecord.payloadHash,
                    expectedOperationVersion: opRecord.operationVersion,
                  },
                });
                const idx = activeOps.findIndex((o) => o.id === opRecord.id);
                if (idx >= 0) activeOps[idx] = queued.operation;
              } catch {
                /* DeliveryGate already denied external effect */
              }
            }
          }
        }

        if (step.action === "create_confirmation_binding") {
          const opId = String(step.tool_args?.operation_id ?? "");
          const op = activeOps.find((o) => o.id === opId);
          if (!op) {
            trace("confirm_op_missing", { opId });
            continue;
          }
          const confId = randomUUID();
          // Message id synthetic for in-memory domain (no FK in memory repo)
          const applied = await this.deps.domain.apply({
            commandId: `${input.commandId}:confirm:${step.step_id}`,
            event: "confirm_valid",
            operationId: op.id,
            confirmation: {
              id: confId,
              operationId: op.id,
              operationVersion: op.operationVersion,
              payloadHash: op.payloadHash,
              confirmationMessageId: input.inbound.messageId,
              actorType: "customer",
              actorId: input.conversation.customerId,
              confirmedAt: context.now,
              expiresAt: new Date(context.now.getTime() + 2700_000),
            },
          });
          const idx = activeOps.findIndex((o) => o.id === op.id);
          if (idx >= 0) activeOps[idx] = applied.operation;
          if (bag) {
            const bi = bag.findIndex((o) => o.id === op.id);
            if (bi >= 0) bag[bi] = applied.operation;
          }
          operationIds.push(op.id);
          trace("confirmed", { id: op.id, status: applied.operation.status });

          lastDelivery = evaluateDeliveryGate({
            intent: "simulate",
            executionMode,
            featureFlags,
            mutationsDisabled: true,
            operation: applied.operation,
            allowToolCalls: policy.allowToolCalls,
            now: context.now,
          });
        }

        if (step.action === "cancel_operation") {
          const opId = String(step.tool_args?.operation_id ?? "");
          const op = activeOps.find((o) => o.id === opId);
          if (!op) continue;
          const event =
            op.status === "awaiting_confirmation" ? "reject" : "cancel";
          const applied = await this.deps.domain.apply({
            commandId: `${input.commandId}:cancel:${step.step_id}`,
            event,
            operationId: op.id,
          } as ApplyCommand);
          const idx = activeOps.findIndex((o) => o.id === op.id);
          if (idx >= 0) activeOps[idx] = applied.operation;
          trace("cancelled", { id: op.id });
        }

        if (step.action === "supersede_operation") {
          const opId = String(step.tool_args?.operation_id ?? "");
          const op = activeOps.find((o) => o.id === opId);
          if (!op) continue;
          const newPayload = {
            ...(typeof op.payload === "object" && op.payload
              ? (op.payload as object)
              : {}),
            ...(step.tool_args?.payload as object),
            corrected: true,
          };
          const applied = await this.deps.domain.apply({
            commandId: `${input.commandId}:supersede:${step.step_id}`,
            event: "correct_payload",
            operationId: op.id,
            supersede: {
              newPayload,
              newPayloadHash: hashPayload(newPayload),
              newIdempotencyKey: randomUUID(),
            },
          });
          if (applied.created) {
            operationIds.push(applied.created.id);
            if (bag && bag !== activeOps) bag.push(applied.created);
            activeOps.push(applied.created);
          }
          const idx = activeOps.findIndex((o) => o.id === op.id);
          if (idx >= 0 && applied.operation) activeOps[idx] = applied.operation;
          trace("superseded", {
            prev: op.id,
            next: applied.created?.id,
          });
        }

        if (step.action === "suspend_intent") {
          const opId = String(step.tool_args?.operation_id ?? "");
          const op = activeOps.find((o) => o.id === opId);
          if (!op) continue;
          const applied = await this.deps.domain.apply({
            commandId: `${input.commandId}:suspend:${step.step_id}`,
            event: "context_incompatible",
            operationId: op.id,
          });
          const idx = activeOps.findIndex((o) => o.id === op.id);
          if (idx >= 0) activeOps[idx] = applied.operation;
          trace("suspended", { id: op.id });
        }
      }

      // 8) DeliveryGate para outbound (siempre suppressed en dry_run)
      const outboundGate = evaluateDeliveryGate({
        intent: "outbound_message",
        executionMode,
        featureFlags,
        mutationsDisabled: true,
        allowToolCalls: policy.allowToolCalls,
        now: context.now,
      });
      lastDelivery = lastDelivery ?? outboundGate;
      trace("delivery_gate_outbound", outboundGate);

      const responseText = composeResponse({
        decision,
        policy,
        delivery: lastDelivery,
      });

      const payloadHashOut = createHash("sha256")
        .update(responseText)
        .digest("hex");
      await this.deps.outbox.enqueue({
        turnId,
        conversationId: input.conversation.conversationId,
        channel: input.inbound.channel,
        channelAccountId: input.inbound.channelAccountId,
        payload: { text: responseText, simulated: true },
        payloadHash: payloadHashOut,
        idempotencyKey: `out:${input.commandId}`,
        status: "suppressed",
        suppressReason:
          outboundGate.reasons.join(",") || "dry_run_phase4",
      });

      const outcome: TurnOutcome =
        policy.plan.some((p) => p.action === "clarify")
          ? "needs_user_input"
          : lastDelivery?.outcome === "denied"
            ? "delivery_suppressed"
            : executionMode === "dry_run"
              ? "ok_simulated"
              : "ok";

      return this.finish({
        turnId,
        input,
        outcome,
        decision,
        policy,
        delivery: lastDelivery,
        responseText,
        operationIds,
        traces,
        ownerId,
        lock,
        executionMode,
      });
    } catch (err) {
      trace("pipeline_error", {
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error && err.message === "persistence_failure") {
        throw err;
      }
      return this.finish({
        turnId,
        input,
        outcome: "failed_cas",
        decision: null,
        policy: null,
        delivery: null,
        responseText: "Error interno controlado. Sin efectos externos.",
        operationIds: [],
        traces,
        ownerId,
        lock,
        executionMode,
        rejection: {
          code: "pipeline_error",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      await this.deps.locks.release(
        input.conversation.conversationId,
        lock.ownerId,
        lock.fencingToken,
      );
      trace("lock_released");
    }
  }

  private async finish(args: {
    turnId: string;
    input: TurnPipelineInput;
    outcome: TurnOutcome;
    decision: OrchestratorDecision | null;
    policy: PolicyDecision | null;
    delivery: DeliveryGateResult | null;
    responseText: string;
    operationIds: string[];
    traces: TraceEvent[];
    ownerId: string;
    lock: { fencingToken: bigint; ownerId: string } | null;
    executionMode: TurnPipelineInput["executionMode"];
    rejection?: TurnPipelineResult["rejection"];
  }): Promise<TurnPipelineResult> {
    try {
      await this.deps.turns.saveTurn(
        {
          id: args.turnId,
          conversationId: args.input.conversation.conversationId,
          idempotencyKey: args.input.commandId,
          outcome: args.outcome,
          mode: args.executionMode ?? "dry_run",
          fencingToken: args.lock?.fencingToken ?? null,
          ownerId: args.lock?.ownerId ?? args.ownerId,
          decision: args.decision,
          policy: args.policy,
          responsePlan: { text: args.responseText, delivery: args.delivery },
        },
        args.traces,
      );
    } catch (err) {
      args.traces.push({
        at: new Date().toISOString(),
        event: "persistence_failed",
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }

    return {
      turnId: args.turnId,
      outcome: args.outcome,
      commandId: args.input.commandId,
      idempotent: false,
      decision: args.decision,
      policy: args.policy,
      delivery: args.delivery,
      responseText: args.responseText,
      operationIds: args.operationIds,
      traces: args.traces,
      rejection: args.rejection,
      lock: args.lock,
    };
  }
}
