import type { OperationStatus } from "@wara-v2/contracts";
import type { OperationDomainEvent } from "./events.js";

export type TransitionSideEffect =
  | "invalidate_confirmation"
  | "require_reconfirm"
  | "create_superseding_version"
  | "record_attempt_outcome"
  | "flag_cancel_requested_after_success"
  | "note_cancel_during_reconcile"
  | "mark_needs_human";

export type TransitionRule = {
  from: OperationStatus | null;
  event: OperationDomainEvent;
  to: OperationStatus;
  /** Destino alternativo evaluado por guardas en runtime. */
  toResolver?: "reconcile_absent";
  effects?: TransitionSideEffect[];
  /** Clave de guarda requerida (evaluada en state-machine). */
  guard?:
    | "binding_match"
    | "mode_ok"
    | "lock_fence"
    | "attempts_lt_max"
    | "context_revalidated"
    | "evidence_success"
    | "evidence_absent"
    | "not_terminal"
    | "payload_version_current";
};

/**
 * Tabla canónica §4.3 (+ create/reject documentados en DIFFERENCES).
 * No inventar filas fuera de esta lista sin actualizar DIFFERENCES.md del paquete.
 */
export const TRANSITION_TABLE: readonly TransitionRule[] = [
  { from: null, event: "create", to: "draft" },
  { from: null, event: "prepare_incomplete", to: "collecting_data" },
  { from: null, event: "prepare_complete", to: "awaiting_confirmation" },
  { from: "draft", event: "prepare_incomplete", to: "collecting_data" },
  { from: "draft", event: "prepare_complete", to: "awaiting_confirmation" },
  {
    from: "collecting_data",
    event: "prepare_complete",
    to: "awaiting_confirmation",
  },
  {
    from: "awaiting_confirmation",
    event: "confirm_valid",
    to: "confirmed",
    guard: "binding_match",
  },
  {
    from: "awaiting_confirmation",
    event: "reject",
    to: "cancelled",
    effects: ["invalidate_confirmation"],
  },
  {
    from: "awaiting_confirmation",
    event: "correct_payload",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "awaiting_confirmation",
    event: "supersede",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "awaiting_confirmation",
    event: "cancel",
    to: "cancelled",
    effects: ["invalidate_confirmation"],
  },
  { from: "awaiting_confirmation", event: "expire", to: "expired" },
  {
    from: "awaiting_confirmation",
    event: "context_incompatible",
    to: "suspended",
    effects: ["invalidate_confirmation"],
  },
  {
    from: "confirmed",
    event: "enqueue_commit",
    to: "queued",
    guard: "mode_ok",
  },
  {
    from: "confirmed",
    event: "correct_payload",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "confirmed",
    event: "supersede",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  { from: "confirmed", event: "expire", to: "expired" },
  {
    from: "confirmed",
    event: "cancel",
    to: "cancelled",
    effects: ["invalidate_confirmation"],
  },
  {
    from: "confirmed",
    event: "context_incompatible",
    to: "suspended",
    effects: ["invalidate_confirmation"],
  },
  {
    from: "queued",
    event: "start_attempt",
    to: "processing",
    guard: "lock_fence",
  },
  { from: "queued", event: "cancel", to: "cancelled" },
  { from: "queued", event: "expire", to: "expired" },
  {
    from: "queued",
    event: "context_incompatible",
    to: "suspended",
    effects: ["invalidate_confirmation"],
  },
  {
    from: "queued",
    event: "supersede",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "queued",
    event: "correct_payload",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "processing",
    event: "attempt_success",
    to: "succeeded",
    guard: "lock_fence",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "processing",
    event: "attempt_retryable_failed",
    to: "retryable_failed",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "processing",
    event: "attempt_permanent_failed",
    to: "permanent_failed",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "processing",
    event: "timeout_before_send",
    to: "retryable_failed",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "processing",
    event: "timeout_after_send",
    to: "unknown_outcome",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "processing",
    event: "ambiguous_result",
    to: "unknown_outcome",
    effects: ["record_attempt_outcome"],
  },
  { from: "processing", event: "user_cancel", to: "cancel_requested" },
  {
    from: "cancel_requested",
    event: "attempt_success",
    to: "succeeded",
    effects: [
      "record_attempt_outcome",
      "flag_cancel_requested_after_success",
    ],
  },
  {
    from: "cancel_requested",
    event: "attempt_retryable_failed",
    to: "cancelled",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "cancel_requested",
    event: "attempt_permanent_failed",
    to: "cancelled",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "cancel_requested",
    event: "timeout_before_send",
    to: "cancelled",
    effects: ["record_attempt_outcome"],
  },
  {
    from: "cancel_requested",
    event: "timeout_after_send",
    to: "unknown_outcome",
    effects: ["record_attempt_outcome", "note_cancel_during_reconcile"],
  },
  {
    from: "cancel_requested",
    event: "ambiguous_result",
    to: "unknown_outcome",
    effects: ["record_attempt_outcome", "note_cancel_during_reconcile"],
  },
  { from: "unknown_outcome", event: "start_reconcile", to: "reconciling" },
  {
    from: "reconciling",
    event: "reconcile_confirmed_success",
    to: "succeeded",
    guard: "evidence_success",
  },
  {
    from: "reconciling",
    event: "reconcile_confirmed_absent",
    to: "retryable_failed",
    toResolver: "reconcile_absent",
    guard: "evidence_absent",
  },
  {
    from: "reconciling",
    event: "reconcile_ambiguous",
    to: "unknown_outcome",
    effects: ["mark_needs_human"],
  },
  {
    from: "retryable_failed",
    event: "retry_allowed",
    to: "queued",
    guard: "attempts_lt_max",
  },
  { from: "retryable_failed", event: "cancel", to: "cancelled" },
  { from: "retryable_failed", event: "expire", to: "expired" },
  {
    from: "retryable_failed",
    event: "context_incompatible",
    to: "suspended",
    effects: ["invalidate_confirmation"],
  },
  {
    from: "retryable_failed",
    event: "correct_payload",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "retryable_failed",
    event: "supersede",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "suspended",
    event: "context_compatible",
    to: "awaiting_confirmation",
    guard: "context_revalidated",
    effects: ["require_reconfirm", "invalidate_confirmation"],
  },
  { from: "suspended", event: "cancel", to: "cancelled" },
  { from: "suspended", event: "expire", to: "expired" },
  {
    from: "suspended",
    event: "correct_payload",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
  {
    from: "suspended",
    event: "supersede",
    to: "superseded",
    effects: ["create_superseding_version", "invalidate_confirmation"],
  },
];
