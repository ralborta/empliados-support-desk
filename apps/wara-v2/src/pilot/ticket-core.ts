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

/**
 * Clasifica categoría del ticket DESPUÉS de que TurnDecision ya eligió ticket/handoff.
 * No elige intención: solo etiqueta el draft.
 */
export function inferTicketCategory(text: string, fallback: TicketCategory = "general"): TicketCategory {
  const t = norm(text);
  if (!t) return fallback;
  if (
    /\b(no\s+puedo\s+entrar|login|loguear|usuario|contrase[nñ]a|acceso|plataforma\s+(ca[ií]da|no\s+anda|no\s+funciona))\b/.test(
      t,
    )
  ) {
    return "access_platform";
  }
  if (/\b(factura|facturacion|facturación|cobro|pago|administraci[oó]n|admin)\b/.test(t)) {
    return "admin";
  }
  if (
    /\b(pantalla|tablet|antena|teclado|t[aá]ctil|garant[ií]a|hardware|equipo\s+gps)\b/.test(t) &&
    /\b(falla|roto|rompe|no\s+prende|no\s+funciona|problema|reclamo)\b/.test(t)
  ) {
    return "technical_support";
  }
  if (
    /\b(od[oó]metro|hor[oó]metro)\b/.test(t) &&
    /\b(no\s+marca|desfasad|falla|roto|mal|problema)\b/.test(t) &&
    !/\b(actualizar|cargar|registrar|cambiar\s+(el\s+)?(km|kilometr|hora))\b/.test(t)
  ) {
    return "odometer_problem";
  }
  if (
    /\b(caso\s+abierto|ticket\s+abierto|novedad|novedades|estado\s+del\s+(caso|ticket)|cerrar\s+(el\s+)?(caso|ticket|conversaci[oó]n)|eta|demora|cuando\s+se\s+resuelve)\b/.test(
      t,
    )
  ) {
    return "case_status";
  }
  if (looksLikeReclamoIntent(text)) return "reclamo";
  if (
    /\b(soporte\s+t[eé]cnico|mesa\s+de\s+(ayuda|entrada)|soporte)\b/.test(t) ||
    looksLikeHumanAdvisorIntent(text)
  ) {
    return "human_advisor";
  }
  if (/\b(reclamo|ticket|caso|problema|falla|aver[ií]a)\b/.test(t)) return "reclamo";
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
    case "access_platform":
      return "Acceso / plataforma";
    case "admin":
      return "Administración / facturación";
    case "technical_support":
      return "Soporte técnico / hardware";
    case "odometer_problem":
      return "Falla de odómetro/horómetro";
    case "case_status":
      return "Estado / cierre de caso";
    case "maintenance_escalation":
      return "Escalación mantenimiento";
    case "certificate_escalation":
      return "Escalación certificado";
    default:
      return "Consulta general";
  }
}
