/**
 * Humanización determinística de saludos YA clasificados (TurnDecision).
 * Solo presentación: no interpreta el mensaje del usuario ni altera policy/reducer/execute.
 */
import { DateTime } from "luxon";
import type { PilotConversationState } from "../conversation-state.js";
import { isHumanizedGreetingEnabled } from "./brain-flags.js";
import { DEFAULT_TENANT_TZ } from "./natural-datetime.js";

export type ClassifiedGreetingDecision = {
  action?: string | null;
  speechAct?: string | null;
  socialAct?: string | null;
  intent?: string | null;
  reasoningCode?: string | null;
  answer?: string | null;
};

/**
 * Saludo humanizable: exige socialAct=greeting del LLM.
 * thanks/farewell nunca pasan. No lee texto del usuario.
 */
export function isClassifiedGreetingDecision(decision: ClassifiedGreetingDecision): boolean {
  if (decision.socialAct !== "greeting") return false;
  if (decision.socialAct === "thanks" || decision.socialAct === "farewell") return false;
  return (
    decision.action === "general" &&
    (decision.intent === "none" || decision.intent == null) &&
    (decision.answer == null || decision.answer === undefined)
  );
}

/** Franjas horarias Argentina (America/Argentina/Buenos_Aires). */
export function argentinaDayGreeting(
  localNow: DateTime,
): "Buenos días" | "Buenas tardes" | "Buenas noches" {
  const hour = localNow.hour;
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

export function sanitizeGreetingName(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = [...value]
    .filter(
      (char) =>
        char === " " ||
        char === "'" ||
        char === "-" ||
        char.toLocaleUpperCase() !== char.toLocaleLowerCase(),
    )
    .join("")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
  return clean || null;
}

const SOCIAL_GREETING_HANDLERS = new Set(["general", "greet"]);

export function isHumanizedGreetingHandler(handler?: string | null): boolean {
  if (!handler) return false;
  return SOCIAL_GREETING_HANDLERS.has(handler);
}

export function summarizePendingForGreeting(state: PilotConversationState): string | null {
  if (state.pendingConfirmation?.action === "gps_report") {
    return `el reporte GPS de ${state.pendingConfirmation.unit.label}`;
  }
  if (state.pendingConfirmation?.action === "certificate_issue") {
    return `el certificado de ${state.pendingConfirmation.unit.label}`;
  }
  if (state.pendingConfirmation?.action === "odometer_write") {
    return `la confirmación de odómetro de ${state.pendingConfirmation.unit.label}`;
  }
  if (state.activeTramite === "odometer_update") {
    const u = state.odometerDraft?.unit?.label ?? state.selectedUnit?.label ?? "la unidad";
    return `la actualización de odómetro/horómetro de ${u}`;
  }
  if (state.activeTramite === "certificate_issue") {
    return `el certificado${state.selectedUnit ? ` de ${state.selectedUnit.label}` : ""}`;
  }
  if (state.suspendedTramite) {
    return `un trámite suspendido (${state.suspendedTramite.tramite})`;
  }
  return null;
}

export function formatHumanizedGreeting(input: {
  customerName?: string | null;
  introducedAtilio: boolean;
  pendingSummary?: string | null;
  localNow: DateTime;
}): string {
  const day = argentinaDayGreeting(input.localNow);
  const name = sanitizeGreetingName(input.customerName);
  const opener = name ? `${day}, ${name}.` : `${day}.`;

  const lines: string[] = [];
  if (!input.introducedAtilio) {
    lines.push(`${opener} Soy Atilio, el asistente virtual de WARA.`);
  } else {
    lines.push(opener);
  }

  const pending = input.pendingSummary?.trim() || null;
  if (pending) {
    lines.push(`Teníamos pendiente ${pending}. ¿Querés continuar?`);
  } else {
    lines.push("¿En qué te ayudo?");
  }

  return lines.join(" ");
}

/** Auditoría: no menú, Atilio solo en 1er contacto, pending íntegro si había. */
export function auditHumanizedGreeting(input: {
  message: string;
  introducedBefore: boolean;
  pendingSummary: string | null;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const msg = input.message;
  if (/•\s|🛣 Odómetro|📍 GPS|🔧 Mantenimiento|elegí la empresa/i.test(msg)) {
    reasons.push("menu_or_options_present");
  }
  if (input.introducedBefore && /Soy Atilio/i.test(msg)) {
    reasons.push("atilio_intro_repeated");
  }
  if (!input.introducedBefore && !/Soy Atilio/i.test(msg)) {
    reasons.push("missing_atilio_intro");
  }
  if (input.pendingSummary?.trim()) {
    const needle = input.pendingSummary.trim();
    if (!msg.includes(needle)) {
      reasons.push("pending_not_preserved");
    }
  }
  if (!/Buenos días|Buenas tardes|Buenas noches/.test(msg)) {
    reasons.push("missing_time_greeting");
  }
  return { ok: reasons.length === 0, reasons };
}

export function maybeApplyHumanizedGreeting(input: {
  draftMessage: string;
  decision: ClassifiedGreetingDecision;
  state: PilotConversationState;
  env: NodeJS.ProcessEnv;
  handler?: string | null;
  /** Inyectable en tests (ya en TZ Argentina). */
  localNow?: DateTime;
}): string {
  if (!isHumanizedGreetingEnabled(input.env)) {
    return input.draftMessage;
  }
  if (!isClassifiedGreetingDecision(input.decision)) {
    return input.draftMessage;
  }
  if (!isHumanizedGreetingHandler(input.handler)) {
    return input.draftMessage;
  }

  if (!input.state.conversationMetadata) {
    input.state.conversationMetadata = { greetedAt: null, introducedAtilio: false };
  }
  const meta = input.state.conversationMetadata;
  const introducedBefore = meta.introducedAtilio;
  const pendingSummary = summarizePendingForGreeting(input.state);
  const localNow =
    input.localNow ?? DateTime.now().setZone(DEFAULT_TENANT_TZ);

  const message = formatHumanizedGreeting({
    customerName: input.state.customerName,
    introducedAtilio: introducedBefore,
    pendingSummary,
    localNow,
  });

  const audit = auditHumanizedGreeting({
    message,
    introducedBefore,
    pendingSummary,
  });
  if (!audit.ok) {
    console.info(
      JSON.stringify({
        event: "wara_v2_humanized_greeting_audit_fail",
        reasons: audit.reasons,
      }),
    );
    return input.draftMessage;
  }

  meta.introducedAtilio = true;
  meta.greetedAt = meta.greetedAt ?? new Date().toISOString();
  return message;
}
