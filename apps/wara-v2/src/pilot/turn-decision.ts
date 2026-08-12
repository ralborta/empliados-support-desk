/**
 * Decisión semántica única por turno — ANTES de cualquier handler operativo.
 * Los handlers no reclasifican el mensaje ni secuestran intenciones nuevas.
 */
import { z } from "zod";
import { classifyServiceIntent, type ServiceIntent } from "./service-catalog.js";
import {
  looksLikeBriefConfirmation,
  looksLikeBriefRejection,
  looksLikeCancelTramite,
  looksLikeChangeUnit,
  looksLikeResumeTramite,
} from "./brief-replies.js";
import type { PilotConversationState } from "./conversation-state.js";

export type TramiteKind =
  | "gps_report"
  | "certificate"
  | "odometer"
  | "maintenance"
  | "ticket"
  | "none";

export type IntentKind =
  | "gps_report"
  | "certificate"
  | "odometer_update"
  | "horometer_update"
  | "maintenance"
  | "ticket"
  | "human_handoff"
  | "unit_search"
  | "cancel"
  | "general";

const ClarifyCandidateSchema = z.object({
  meaning: z.string(),
  intent: z.string().optional(),
  targetTramite: z.string().optional(),
});

export const TurnDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer_pending"),
    answer: z.enum(["confirm", "reject", "provide_fields"]),
    targetTramite: z.enum(["gps_report", "certificate", "odometer", "maintenance", "ticket", "none"]),
    confidence: z.number(),
  }),
  z.object({
    kind: z.literal("start_new_intent"),
    intent: z.enum([
      "gps_report",
      "certificate",
      "odometer_update",
      "horometer_update",
      "maintenance",
      "ticket",
      "human_handoff",
      "unit_search",
      "cancel",
      "general",
    ]),
    suspendCurrent: z.boolean(),
    confidence: z.number(),
  }),
  z.object({
    kind: z.literal("correct_current"),
    fields: z.record(z.string(), z.unknown()),
    confidence: z.number(),
  }),
  z.object({
    kind: z.literal("lateral_query"),
    intent: z.enum([
      "gps_report",
      "certificate",
      "odometer_update",
      "horometer_update",
      "maintenance",
      "ticket",
      "human_handoff",
      "unit_search",
      "cancel",
      "general",
    ]),
    resumeAfter: z.boolean(),
    confidence: z.number(),
  }),
  z.object({
    kind: z.literal("clarify"),
    candidates: z.array(ClarifyCandidateSchema).min(1),
    question: z.string().min(1),
    confidence: z.number().optional(),
  }),
  z.object({
    kind: z.literal("general"),
    confidence: z.number(),
  }),
]);

export type TurnDecision = z.infer<typeof TurnDecisionSchema>;

function normKeepPunctuation(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True si hay coma/pausa explícita tras «no» (desambigua «no, quiero X»). */
export function hasExplicitNoComma(text: string): boolean {
  return /^no\s*[,;:]\s*/i.test(text.trim());
}

export function pendingTramiteFromState(state: PilotConversationState): TramiteKind {
  const action = state.pendingConfirmation?.action;
  if (action === "gps_report") return "gps_report";
  if (action === "certificate_issue") return "certificate";
  if (action === "odometer_write") return "odometer";
  if (action === "maintenance_write") return "maintenance";
  if (action === "odoo_ticket_create") return "ticket";
  if (state.activeTramite === "certificate_issue") return "certificate";
  if (state.activeTramite === "odometer_update") return "odometer";
  if (state.activeTramite === "maintenance_consult" || state.activeTramite === "maintenance_request") {
    return "maintenance";
  }
  if (state.activeTramite === "odoo_ticket") return "ticket";
  if (state.activeTramite === "await_confirm" && state.pendingConfirmation?.action === "gps_report") {
    return "gps_report";
  }
  if (state.activeTramite === "unit_gps_report") return "gps_report";
  return "none";
}

function serviceToIntent(s: ServiceIntent): IntentKind | null {
  switch (s) {
    case "certificate":
      return "certificate";
    case "odometer_update":
      return "odometer_update";
    case "horometer_update":
      return "horometer_update";
    case "gps_report":
      return "gps_report";
    case "maintenance":
      return "maintenance";
    case "ticket":
      return "ticket";
    case "human_handoff":
      return "human_handoff";
    default:
      return null;
  }
}

function intentToTramite(intent: IntentKind): TramiteKind {
  if (intent === "certificate") return "certificate";
  if (intent === "odometer_update" || intent === "horometer_update") return "odometer";
  if (intent === "gps_report") return "gps_report";
  if (intent === "maintenance") return "maintenance";
  if (intent === "ticket" || intent === "human_handoff") return "ticket";
  return "none";
}

function labelTramite(t: TramiteKind): string {
  switch (t) {
    case "gps_report":
      return "reporte GPS";
    case "certificate":
      return "certificado";
    case "odometer":
      return "odómetro/horómetro";
    case "maintenance":
      return "mantenimiento";
    case "ticket":
      return "reclamo";
    default:
      return "trámite";
  }
}

function labelIntent(i: IntentKind): string {
  switch (i) {
    case "certificate":
      return "certificado";
    case "odometer_update":
      return "odómetro";
    case "horometer_update":
      return "horómetro";
    case "gps_report":
      return "reporte GPS";
    case "maintenance":
      return "mantenimiento";
    case "ticket":
      return "reclamo";
    case "human_handoff":
      return "atención humana";
    default:
      return i;
  }
}

/**
 * Detecta «no quiero [servicio]» sin coma tras «no».
 * Ambiguo: puede ser rechazo del servicio nombrado O «No, quiero [servicio]».
 */
export function detectAmbiguousNoQuiero(
  text: string,
  pending: TramiteKind,
): { mentioned: IntentKind; pending: TramiteKind } | null {
  const raw = text.trim();
  if (!raw) return null;
  if (hasExplicitNoComma(raw)) return null; // «no, quiero X» no es ambiguo
  const n = normKeepPunctuation(raw);
  // «no quiero …» / «no necesito …» + servicio
  if (!/^no\s+(quiero|necesito|deseo)\b/.test(n)) return null;

  const mentionedService = classifyServiceIntent(raw);
  const mentioned = serviceToIntent(mentionedService);
  if (!mentioned || mentioned === "cancel" || mentioned === "general") return null;

  const mentionedTramite = intentToTramite(mentioned);
  // Si nombra el MISMO trámite pendiente → rechazo claro del pendiente (no ambiguo entre trámites).
  if (pending !== "none" && mentionedTramite === pending) return null;
  // Si nombra OTRO servicio distinto del pendiente → ambiguo.
  if (pending !== "none" && mentionedTramite !== pending) {
    return { mentioned, pending };
  }
  // Sin pendiente: «no quiero certificado» solo es cancelación de algo inexistente / start ambiguo.
  // Con GPS pendiente ya cubierto arriba. Sin pendiente + «no quiero certificado» → clarify o ignore.
  if (pending === "none") {
    return { mentioned, pending };
  }
  return null;
}

function bareNo(text: string): boolean {
  return /^(no|nop|nope|nah)[\s!.?]*$/i.test(text.trim());
}

/**
 * Produce la decisión del turno. Única entrada semántica antes de handlers.
 */
export function decideTurn(text: string, state: PilotConversationState): TurnDecision {
  const raw = text.trim();
  const pending = pendingTramiteFromState(state);
  const unitLabel = state.selectedUnit?.label ?? "la unidad activa";

  // 1) Ambiguiedad «no quiero [otro servicio]» sin coma
  const amb = detectAmbiguousNoQuiero(raw, pending);
  if (amb) {
    if (pending === "none") {
      return TurnDecisionSchema.parse({
        kind: "clarify",
        candidates: [
          {
            meaning: `No querés el ${labelIntent(amb.mentioned)}`,
            intent: amb.mentioned,
          },
          {
            meaning: `Sí querés el ${labelIntent(amb.mentioned)} (entendí «no, quiero…»)`,
            intent: amb.mentioned,
          },
        ],
        question: `¿Querés decir que no querés el ${labelIntent(amb.mentioned)}, o que sí lo querés?`,
        confidence: 0.4,
      });
    }
    return TurnDecisionSchema.parse({
      kind: "clarify",
      candidates: [
        {
          meaning: `Cancelar el ${labelTramite(pending)} y pedir ${labelIntent(amb.mentioned)}`,
          intent: amb.mentioned,
          targetTramite: pending,
        },
        {
          meaning: `Rechazar solo el ${labelTramite(pending)} (sin iniciar ${labelIntent(amb.mentioned)})`,
          targetTramite: pending,
        },
        {
          meaning: `Continuar el ${labelTramite(pending)}`,
          targetTramite: pending,
        },
      ],
      question: `¿Querés cancelar el ${labelTramite(pending)} y solicitar el ${labelIntent(amb.mentioned)} de ${unitLabel}?`,
      confidence: 0.45,
    });
  }

  // 1b) «no quiero [mismo servicio pendiente]» → rechazo claro del pendiente
  {
    const n = normKeepPunctuation(raw);
    if (/^no\s+(quiero|necesito|deseo)\b/.test(n) && pending !== "none" && !hasExplicitNoComma(raw)) {
      const mentioned = serviceToIntent(classifyServiceIntent(raw));
      if (mentioned && intentToTramite(mentioned) === pending) {
        return TurnDecisionSchema.parse({
          kind: "answer_pending",
          answer: "reject",
          targetTramite: pending,
          confidence: 0.88,
        });
      }
    }
  }

  // 2) «no, quiero X» explícito → rechazo del pendiente + start new
  if (hasExplicitNoComma(raw) && pending !== "none") {
    const rest = raw.replace(/^no\s*[,;:]\s*/i, "").trim();
    const svc = serviceToIntent(classifyServiceIntent(rest));
    if (svc && intentToTramite(svc) !== pending) {
      return TurnDecisionSchema.parse({
        kind: "start_new_intent",
        intent: svc,
        suspendCurrent: true,
        confidence: 0.9,
      });
    }
  }

  // 3) Confirmación / rechazo breve del pendiente
  if (pending !== "none") {
    // «otra unidad» no es rechazo del trámite — lo maneja el router de cambio de unidad.
    if (looksLikeChangeUnit(raw)) {
      return TurnDecisionSchema.parse({ kind: "general", confidence: 0.6 });
    }
    if (looksLikeBriefConfirmation(raw) || /^confirmo\b/i.test(raw)) {
      return TurnDecisionSchema.parse({
        kind: "answer_pending",
        answer: "confirm",
        targetTramite: pending,
        confidence: 0.95,
      });
    }
    if (bareNo(raw) || looksLikeBriefRejection(raw)) {
      return TurnDecisionSchema.parse({
        kind: "answer_pending",
        answer: "reject",
        targetTramite: pending,
        confidence: 0.9,
      });
    }
    if (looksLikeCancelTramite(raw)) {
      return TurnDecisionSchema.parse({
        kind: "answer_pending",
        answer: "reject",
        targetTramite: pending,
        confidence: 0.92,
      });
    }
  }

  if (looksLikeResumeTramite(raw) && state.suspendedTramite) {
    return TurnDecisionSchema.parse({
      kind: "lateral_query",
      intent: "general",
      resumeAfter: true,
      confidence: 0.9,
    });
  }

  // 4) Nueva intención de servicio explícita
  const svc = serviceToIntent(classifyServiceIntent(raw));
  if (svc && svc !== "cancel") {
    const svcTramite = intentToTramite(svc);
    const n = normKeepPunctuation(raw);
    // Cambio de trámite requiere señal explícita — no bastan palabras de detalle
    // («falla en el motor» = ticket en catálogo, pero es campo de mantenimiento).
    const explicitSwitchCue =
      /\b(quiero|necesito|dese[oa]|mejor|dej[aá]|despues|antes|informar|dame|pasame|solicitar|pedir|cambi(ar|emos|á|a)?)\b/.test(
        n,
      );

    // GPS / estado durante trámite de escritura → consulta lateral (no reemplazar).
    if (
      svc === "gps_report" &&
      (pending === "odometer" || pending === "certificate" || pending === "maintenance" || pending === "ticket")
    ) {
      return TurnDecisionSchema.parse({
        kind: "lateral_query",
        intent: "gps_report",
        resumeAfter: true,
        confidence: 0.88,
      });
    }

    if (pending !== "none" && svcTramite !== pending) {
      if (!explicitSwitchCue) {
        // Respuesta de campo / corrección del trámite activo — no suspender.
        return TurnDecisionSchema.parse({
          kind: "answer_pending",
          answer: "provide_fields",
          targetTramite: pending,
          confidence: 0.7,
        });
      }
      return TurnDecisionSchema.parse({
        kind: "start_new_intent",
        intent: svc,
        suspendCurrent: true,
        confidence: 0.9,
      });
    }
    if (pending === "none" || svcTramite === pending) {
      return TurnDecisionSchema.parse({
        kind: "start_new_intent",
        intent: svc,
        suspendCurrent: false,
        confidence: 0.9,
      });
    }
  }

  // 5) Cancelación genérica sin servicio
  if (looksLikeCancelTramite(raw) && pending !== "none") {
    return TurnDecisionSchema.parse({
      kind: "answer_pending",
      answer: "reject",
      targetTramite: pending,
      confidence: 0.85,
    });
  }

  return TurnDecisionSchema.parse({ kind: "general", confidence: 0.5 });
}

export function validateTurnDecision(raw: unknown): TurnDecision | null {
  const parsed = TurnDecisionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
