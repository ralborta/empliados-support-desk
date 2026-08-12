/**
 * Reglas determinísticas tickets Odoo / derivación humana V2.
 */
import type { TicketCategory } from "./ticket-types.js";
import type { MaintenancePriority } from "./maintenance-types.js";
import { inferMaintenancePriority } from "./maintenance-core.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function looksLikeHumanAdvisorIntent(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  return (
    /\b(operador|asesor|humano|persona|agente|atencion|atención)\b/.test(t) ||
    /\b(hablar con|quiero que me atienda|derivar|escalar)\b/.test(t)
  );
}

export function looksLikeReclamoIntent(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  return /\b(reclamo|queja|insatisfaccion|insatisfacción|mal servicio)\b/.test(t);
}

export function looksLikeTicketIntent(text: string | undefined | null): boolean {
  return looksLikeHumanAdvisorIntent(text) || looksLikeReclamoIntent(text);
}

export function inferTicketCategory(text: string, fallback: TicketCategory = "general"): TicketCategory {
  if (looksLikeReclamoIntent(text)) return "reclamo";
  if (looksLikeHumanAdvisorIntent(text)) return "human_advisor";
  return fallback;
}

export function inferTicketPriority(text: string): MaintenancePriority {
  return inferMaintenancePriority(text);
}

export function looksLikeCancelTicket(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  return /\b(cancelar|cancela|no quiero|olvidalo)\b/.test(t);
}

export function categoryLabel(category: TicketCategory): string {
  switch (category) {
    case "human_advisor":
      return "Derivación a operador";
    case "reclamo":
      return "Reclamo";
    case "maintenance_escalation":
      return "Escalación mantenimiento";
    case "certificate_escalation":
      return "Escalación certificado";
    default:
      return "Consulta general";
  }
}
