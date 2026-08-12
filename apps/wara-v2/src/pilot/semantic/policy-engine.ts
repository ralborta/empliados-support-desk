/**
 * Policy engine determinístico post-LLM.
 * Acepta / pide aclaración / bloquea. NO reclasifica lenguaje.
 */
import type { TurnDecision } from "./turn-decision-schema.js";
import { safeClarifyDecision } from "./turn-decision-schema.js";
import type { PilotConversationState } from "../conversation-state.js";

const CAPABILITIES = new Set([
  "unit_list",
  "unit_search",
  "gps",
  "odometer",
  "horometer",
  "maintenance",
  "certificate",
  "ticket",
  "human_handoff",
  "none",
]);

export type PolicyResult =
  | { ok: true; decision: TurnDecision }
  | { ok: false; decision: TurnDecision; reason: string };

function isValidDate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(`${iso}T12:00:00`));
}

function isValidTime(t: string): boolean {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());
}

export function applySemanticPolicy(
  decision: TurnDecision,
  state: PilotConversationState,
  opts?: { timezone?: string },
): PolicyResult {
  const tz = opts?.timezone ?? "America/Argentina/Buenos_Aires";

  if (!CAPABILITIES.has(decision.intent)) {
    return {
      ok: false,
      reason: "unknown_capability",
      decision: safeClarifyDecision("Ese servicio no está disponible. ¿Qué necesitás?"),
    };
  }

  if (decision.action === "clarify") {
    if (!decision.ambiguity?.question?.trim()) {
      return { ok: false, reason: "clarify_without_question", decision: safeClarifyDecision() };
    }
    // Ambigüedad nunca produce efectos
    return {
      ok: true,
      decision: { ...decision, currentTramiteDisposition: "keep" },
    };
  }

  if (
    (decision.action === "switch_intent" ||
      decision.action === "suspend_and_start" ||
      decision.action === "start_intent") &&
    decision.intent === "none"
  ) {
    return {
      ok: false,
      reason: "start_without_intent",
      decision: safeClarifyDecision("¿Qué servicio querés iniciar?"),
    };
  }

  if (decision.entity?.type === "plate" || decision.entity?.type === "unit_name") {
    const v = decision.entity.value?.trim() ?? "";
    if (!v || v.length > 40) {
      return {
        ok: false,
        reason: "entity_invalid",
        decision: safeClarifyDecision("¿Me pasás la patente o el nombre de la unidad?"),
      };
    }
    // Evitar que el modelo meta la frase completa como value
    if (/\s/.test(v) && v.split(/\s+/).length > 3) {
      return {
        ok: false,
        reason: "entity_too_verbose",
        decision: safeClarifyDecision("¿Cuál es el prefijo o la patente exacta?"),
      };
    }
  }

  if (decision.fields?.date) {
    if (!isValidDate(decision.fields.date)) {
      return {
        ok: false,
        reason: "invalid_date",
        decision: safeClarifyDecision("No pude validar esa fecha. ¿Me la decís de nuevo?"),
      };
    }
  }
  if (decision.fields?.time) {
    if (!isValidTime(decision.fields.time)) {
      return {
        ok: false,
        reason: "invalid_time",
        decision: safeClarifyDecision("No pude validar esa hora. Usá formato 11:30."),
      };
    }
  }

  // Fecha futura en lecturas: preferir el mismo día de la semana anterior (no reclasifica lenguaje).
  if (decision.fields?.date && decision.action === "provide_fields") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    if (decision.fields.date > today) {
      const meterIntent =
        decision.intent === "odometer" ||
        decision.intent === "horometer" ||
        state.activeTramite === "odometer_update";
      if (meterIntent) {
        const [y, m, d] = decision.fields.date.split("-").map(Number);
        const dt = new Date(Date.UTC(y!, m! - 1, d!));
        dt.setUTCDate(dt.getUTCDate() - 7);
        const snapped = dt.toISOString().slice(0, 10);
        if (snapped <= today) {
          return {
            ok: true,
            decision: {
              ...decision,
              fields: { ...decision.fields, date: snapped, timezone: decision.fields.timezone ?? tz },
            },
          };
        }
      }
      return {
        ok: false,
        reason: "future_date",
        decision: safeClarifyDecision(
          `La fecha ${decision.fields.date} parece futura. ¿Es correcta o preferís otra?`,
        ),
      };
    }
  }

  // answer_pending requiere pending real
  if (decision.action === "answer_pending" && !state.pendingConfirmation) {
    // Permitir si hay draft activo esperando campos — se trata como provide
    if (decision.answer === "confirm" || decision.answer === "reject") {
      return {
        ok: false,
        reason: "no_pending_confirmation",
        decision: safeClarifyDecision("No tengo una confirmación pendiente. ¿Qué necesitás?"),
      };
    }
  }

  return { ok: true, decision };
}
