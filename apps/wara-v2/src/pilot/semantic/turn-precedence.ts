/**
 * Precedencia de turno + guardrails de escritura / contexto de sesión.
 *
 * Principio: la decisión semántica viene del LLM (TurnDecision).
 * Este módulo tipifica expectativas y SOLO puede bloquear escrituras dudosas.
 * Nunca autoriza una escritura por heurística lingüística.
 */
import type { PilotConversationState, PilotPendingConfirmation } from "../conversation-state.js";
import { buildCompanyStatusReply } from "../wara-format.js";

export type ExpectedAnswerType =
  | "confirmation"
  | "cancel_confirmation"
  | "company"
  | "unit"
  | "numeric_value"
  | "date"
  | "time"
  | "clarification"
  | "choice";

export type LastAgentQuestionMeta = {
  id: string;
  purpose: string;
  text: string;
  expectedAnswerType: ExpectedAnswerType;
  options?: Array<{ id: string; meaning: string }>;
  pendingAction?: PilotPendingConfirmation["action"] | null;
  operationId?: string | null;
  operationVersion?: number | null;
};

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCompanyContext(state: PilotConversationState) {
  return {
    activeCompanyId: state.selectedContactId != null ? String(state.selectedContactId) : null,
    activeCompanyName: state.companyName,
    availableCompanies: state.contacts.map((c) => ({
      id: String(c.id),
      name: c.empresa || c.nombre,
    })),
    pendingCompanySelection: !state.companyName && state.contacts.length > 1,
  };
}

export function replyActiveCompany(state: PilotConversationState): string {
  if (state.companyName) {
    if (state.contacts.length > 1) {
      return buildCompanyStatusReply(state.companyName, state.contacts);
    }
    return `Estás operando con ${state.companyName}.`;
  }
  if (state.contacts.length === 1) {
    const c = state.contacts[0]!;
    const name = c.empresa || c.nombre;
    return `Todavía no habías confirmado empresa; este número está asociado a ${name}. ¿Seguimos con esa?`;
  }
  if (state.contacts.length > 1) {
    return `Todavía no seleccionaste una empresa. ¿Con cuál querés continuar?\n\n${buildCompanyStatusReply(null, state.contacts)}`;
  }
  return "Todavía no seleccionaste una empresa y no encontré empresas asociadas a tu número.";
}

/**
 * Protección mínima: despedida/cortesía/cancelación en el texto
 * → BLOQUEA escritura. Nunca autoriza.
 */
export function mustBlockWriteExecution(text: string): boolean {
  const t = norm(text);
  if (!t) return true;
  if (isFarewellOrCourtesyClose(t)) return true;
  if (/\b(cancelo|cancelalo|cancelar|no\s+confirmo|no\s+lo\s+hagas|mejor\s+no|olvidalo|dejalo|lo\s+cancelo|quiero\s+cancelar)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Cierre conversacional — solo para bloquear escrituras / cancelar pendientes. */
export function isFarewellOrCourtesyClose(text: string): boolean {
  const t = norm(text);
  if (!t || t.length > 80) return false;
  if (/\b(confirmo|confirmalo|hacelo|odometro|certificado|mantenimiento|ticket|empresa|unidad|patente|cancel)\b/.test(t)) {
    return false;
  }
  return (
    /^(gracias(\s+chau)?|chau|adios|adi[oó]s|nos\s+vemos|hablamos(\s+luego)?|hasta\s+luego|bye|listo\s+gracias|gracias\s+listo|despues\s+veo|después\s+veo|dejal[oa]\s+ahi|dej[eé]moslo\s+ahi)$/.test(
      t,
    ) ||
    /^(ok\s+)?gracias(\s+(chau|adios|adi[oó]s))?$/.test(t) ||
    /^(gracias|porfa|por\s+favor)$/.test(t)
  );
}

/** @deprecated alias — solo bloqueo / cancel-safety */
export function looksLikeFarewell(text: string): boolean {
  return isFarewellOrCourtesyClose(text);
}

/**
 * Cancel-safety: señales inequívocas de cancelar el pending.
 * Solo se usa para CANCELAR o bloquear escritura — no para iniciar trámites.
 */
export function looksLikeUnequivocalCancelRequest(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (/\b(ahora\s+)?(pasame|dame|quiero|necesito)\b/.test(t) && /\b(estado|gps|reporte|odometro|certificado)\b/.test(t)) {
    if (!/\bcancel/.test(t) && !/\bno\s+est[aá]\s+bien/.test(t)) return false;
  }
  if (/^(cancelo|cancelalo|cancelala|cancelar|cancela|anular|anula|dejalo|dejala|olvidalo|olvidala)$/.test(t)) {
    return true;
  }
  if (/^(no\s+lo\s+hagas|mejor\s+no|no\s+confirmo|no\s+quiero\s+hacerlo)$/.test(t)) return true;
  if (/\bno\s+est[aá]\s+bien\b/.test(t) && /\bcancel/.test(t)) return true;
  if (/\b(lo\s+)?cancelo\b/.test(t) || /\bquiero\s+cancelar\b/.test(t)) return true;
  if (/^(si|s[ií])\s*,?\s*(quiero\s+)?cancelar/.test(t)) return true;
  if (/\bno\s+quiero\s+(hacerlo|continuar|seguir|confirmar)\b/.test(t)) return true;
  return false;
}

/**
 * Autorización de escritura: SOLO decisión estructurada + binding.
 * La heurística puede vetoar; nunca autoriza por sí sola.
 */
export function assertStructuredWriteConfirmation(input: {
  decisionAnswer: string | null | undefined;
  confidence: number;
  state: PilotConversationState;
  originalMessage: string;
  expectedAction: PilotPendingConfirmation["action"];
}): { ok: true } | { ok: false; reason: string } {
  if (input.decisionAnswer !== "confirm") {
    return { ok: false, reason: "decision_not_confirm" };
  }
  if (input.confidence < 0.7) {
    return { ok: false, reason: "confidence_too_low" };
  }
  if (mustBlockWriteExecution(input.originalMessage)) {
    return { ok: false, reason: "blocked_by_safety_heuristic" };
  }

  const pending = input.state.pendingConfirmation;
  if (!pending) return { ok: false, reason: "no_pending" };
  if (pending.action !== input.expectedAction) {
    return { ok: false, reason: "pending_action_mismatch" };
  }

  const meta = input.state.lastAgentQuestionMeta;
  if (!meta) return { ok: false, reason: "missing_last_agent_question" };
  if (meta.expectedAnswerType !== "confirmation") {
    return { ok: false, reason: "question_not_write_confirmation" };
  }
  if (meta.pendingAction && meta.pendingAction !== pending.action) {
    return { ok: false, reason: "question_other_tramite" };
  }
  if (pending.questionId && meta.id !== pending.questionId) {
    return { ok: false, reason: "stale_question_id" };
  }
  if (
    meta.operationId &&
    pending.operationId &&
    meta.operationId !== pending.operationId
  ) {
    return { ok: false, reason: "operation_id_mismatch" };
  }
  if (
    meta.operationVersion != null &&
    pending.version != null &&
    meta.operationVersion !== pending.version
  ) {
    return { ok: false, reason: "operation_version_mismatch" };
  }

  return { ok: true };
}

export function setLastAgentQuestion(
  state: PilotConversationState,
  input: {
    text: string;
    purpose: string;
    expectedAnswerType: ExpectedAnswerType;
    options?: Array<{ id: string; meaning: string }>;
    pendingAction?: PilotPendingConfirmation["action"] | null;
  },
): void {
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const pending = state.pendingConfirmation;
  const version = pending?.version ?? 1;
  state.lastAgentQuestion = input.text;
  state.lastAgentQuestionMeta = {
    id,
    purpose: input.purpose,
    text: input.text,
    expectedAnswerType: input.expectedAnswerType,
    options: input.options,
    pendingAction: input.pendingAction ?? pending?.action ?? null,
    operationId: pending?.operationId ?? null,
    operationVersion: version,
  };
  if (pending && input.expectedAnswerType === "confirmation") {
    state.pendingConfirmation = {
      ...pending,
      question: input.text,
      questionId: id,
      version,
    };
  }
}

export function clearLastAgentQuestion(state: PilotConversationState): void {
  state.lastAgentQuestion = null;
  state.lastAgentQuestionMeta = null;
}

export function bindPendingConfirmationQuestion(
  state: PilotConversationState,
  question: string,
  purpose: string,
): void {
  const pending = state.pendingConfirmation;
  if (!pending) return;
  const version = (pending.version ?? 0) + 1;
  state.pendingConfirmation = { ...pending, question, version };
  setLastAgentQuestion(state, {
    text: question,
    purpose,
    expectedAnswerType: "confirmation",
    pendingAction: pending.action,
  });
}

export function inferExpectedAnswerTypeFromQuestion(
  question: string,
  pendingAction?: PilotPendingConfirmation["action"] | null,
): ExpectedAnswerType {
  const q = norm(question);
  if (/\bqueres\s+cancelar\b/.test(q) || /\bcancelar\s+la\s+solicitud\b/.test(q)) {
    return "cancel_confirmation";
  }
  if (/\bdescartar\b/.test(q) && /\bmodificar\b/.test(q)) return "choice";
  if (/\bconfirmo\b/.test(q) || /\best[aá]\s+correcto\b/.test(q)) return "confirmation";
  if (pendingAction && pendingAction !== "gps_report") return "confirmation";
  if (/\bempresa\b/.test(q)) return "company";
  if (/\bfecha\b/.test(q)) return "date";
  if (/\bhora\b/.test(q)) return "time";
  return "clarification";
}

export function isAmbiguousCancelClarifyQuestion(question: string | null | undefined): boolean {
  const q = norm(String(question ?? ""));
  if (!q) return false;
  return /\bcancel/.test(q) && /\bno\s+queres\s+hacer\s+ningun/.test(q);
}

export const DISCARD_OR_EDIT_QUESTION =
  "¿Querés descartar esta solicitud o modificar algún dato?";
