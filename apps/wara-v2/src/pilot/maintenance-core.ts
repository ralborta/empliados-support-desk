/**
 * Reglas determinísticas mantenimiento V2 (portadas de V1 mantenimiento-operativo).
 */
import type { MaintenancePriority } from "./maintenance-types.js";
import { detectLoosePlate } from "./plates.js";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function inferMaintenanceService(raw: string): string {
  const text = norm(raw);
  if (/(correctiv|aver[ií]a|falla|rotura)/.test(text)) return "Correctivo";
  if (/(rfid|neum[aá]tic|cubierta)/.test(text)) return "Neumaticos RFID";
  if (/(plan|preventiv)/.test(text)) return "Plan de mantenimiento";
  if (/(tarea|orden de trabajo)/.test(text)) return "Tarea de mantenimiento";
  return "Gestion de mantenimiento";
}

export function inferMaintenancePriority(raw: string): MaintenancePriority {
  const text = norm(raw);
  if (/(urgente|cr[ií]tic|parad|detenid)/.test(text)) return "URGENT";
  if (/(alta|correctiv|falla|no funciona|error)/.test(text)) return "HIGH";
  if (/(baja|leve)/.test(text)) return "LOW";
  return "NORMAL";
}

export function priorityLabel(priority: MaintenancePriority): string {
  switch (priority) {
    case "URGENT":
      return "Urgente";
    case "HIGH":
      return "Alta";
    case "LOW":
      return "Baja";
    default:
      return "Normal";
  }
}

export function looksLikeMaintenanceConsultIntent(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  if (/\b(solicitar|pedir|programar|registrar|generar|abrir|agendar)\b/.test(t)) return false;
  if (!/\b(mantenimient\w*|preventiv\w*|correctiv\w*|tarea|plan)\b/.test(t)) return false;
  return /\b(consultar|consulta|ver|estado|proxim\w*|pr[oó]xim\w*|vencid\w*|pendient\w*|cu[aá]ndo|programad\w*)\b/.test(t);
}

export function looksLikeMaintenanceRequestIntent(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = norm(raw);
  if (/\b(od[oó]metro|hor[oó]metro|kilometraje|certificado|cobertura)\b/.test(t)) return false;
  if (looksLikeMaintenanceHowToIntent(raw)) return false;
  if (looksLikeMaintenanceConsultIntent(raw)) return false;
  return (
    (/\b(mantenimient\w*|preventiv\w*|correctiv\w*|tarea|plan)\b/.test(t) &&
      /\b(solicitar|pedir|programar|registrar|generar|abrir|necesito|quiero|agendar)\b/.test(t)) ||
    /\b(solicitud de gestion de mantenimiento)\b/.test(t)
  );
}

export function looksLikeMaintenanceIntent(text: string | undefined | null): boolean {
  return looksLikeMaintenanceConsultIntent(text) || looksLikeMaintenanceRequestIntent(text);
}

export function looksLikeMaintenanceHowToIntent(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  const maintenanceDomain =
    /\b(mantenimient\w*|preventiv\w*|correctiv\w*|tarea|plan|combustible|rendimiento|consumo|neumatic|rfid|cubierta|averia|falla|orden de trabajo)\b/;
  const howToCue =
    /(como|enseña|ensena|explica|ayuda|paso a paso|configur|crear|cargar|usar|utilizar|modulo|saber|conocer|informacion|como se|cómo se|como hago|cómo hago)/;
  if (!maintenanceDomain.test(t) || !howToCue.test(t)) return false;
  if (/\b(solicitar|pedir|programar|registrar|generar|abrir|agendar)\b/.test(t)) return false;
  return true;
}

export function looksLikeCancelMaintenance(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  return /\b(cancelar|cancela|no quiero|dej[aá]|olvidalo|salir del tr[aá]mite)\b/.test(t);
}

export function extractMaintenanceDetail(text: string, service: string, plateLabel: string | null): string {
  const raw = String(text ?? "").trim();
  if (!raw) return `Mantenimiento para ${plateLabel ?? "unidad"}`;
  if (detectLoosePlate(raw) && raw.replace(/\s+/g, "").length <= 12) {
    return `${service} para ${plateLabel ?? raw}`;
  }
  return raw;
}

export function formatMaintenanceConsultReply(input: {
  unitLabel: string;
  odometro: number | null;
  horometro: number | null;
  ultimoReporteSeg: number | null;
}): string {
  const lines = [`Estado operativo de ${input.unitLabel} (WARA):`];
  if (input.odometro != null) lines.push(`• Odómetro: ${input.odometro} km`);
  if (input.horometro != null) lines.push(`• Horómetro: ${input.horometro} hs`);
  if (input.ultimoReporteSeg != null) {
    const mins = Math.round(input.ultimoReporteSeg / 60);
    lines.push(`• Último reporte: hace ${mins} min`);
  }
  lines.push(
    "",
    "La API de flota no expone agenda de mantenimientos vencidos o próximos.",
    "Si querés registrar una solicitud, decime el detalle (preventivo/correctivo) y te pido confirmación.",
  );
  return lines.join("\n");
}
