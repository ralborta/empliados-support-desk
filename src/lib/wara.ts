export type WaraIncidentType =
  | "MISSING_REPORT"
  | "ODOMETER_CHANGE"
  | "CERTIFICATE_ISSUE"
  | "ACCESS_PLATFORM"
  | "GENERAL_TECH"
  | "ADMIN_DERIVATION"
  | "OTHER";

export type ResolutionMode =
  | "CHAT_RESOLVED"
  | "PENDING_VALIDATION"
  | "BACKOFFICE_DERIVED"
  | "TECH_ESCALATED"
  | "CLOSED_NO_ACTION";

export const waraIncidentLabels: Record<WaraIncidentType, string> = {
  MISSING_REPORT: "Falta de reporte",
  ODOMETER_CHANGE: "Cambio de odómetro",
  CERTIFICATE_ISSUE: "Emisión de certificado",
  ACCESS_PLATFORM: "Acceso / plataforma",
  GENERAL_TECH: "Consulta técnica general",
  ADMIN_DERIVATION: "Derivación administrativa",
  OTHER: "Otro",
};

export const resolutionModeLabels: Record<ResolutionMode, string> = {
  CHAT_RESOLVED: "Resuelto en chat",
  PENDING_VALIDATION: "Pendiente de validación",
  BACKOFFICE_DERIVED: "Derivado a backoffice",
  TECH_ESCALATED: "Escalado técnico",
  CLOSED_NO_ACTION: "Cerrado sin acción",
};

const PLATE_REGEX = /\b([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3})\b/i;

export function normalizePlate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase().replace(/\s+/g, "");
}

export function detectPlate(text: string): string | null {
  const match = text.match(PLATE_REGEX);
  return normalizePlate(match?.[1] || null);
}

export function detectIncidentType(text: string): WaraIncidentType {
  const lower = text.toLowerCase();
  if (/(no reporta|offline|sin señal|no actualiza|última señal|ultima señal|no registra ubicación)/.test(lower)) {
    return "MISSING_REPORT";
  }
  if (/(od[oó]metro|kilometraje|cambio de od[oó]metro|corregir kil[oó]metros|\bkm\b)/.test(lower)) {
    return "ODOMETER_CHANGE";
  }
  if (/(certificado|habilitar monitoreo|certificado de monitoreo)/.test(lower)) {
    return "CERTIFICATE_ISSUE";
  }
  if (/(acceso|login|usuario|contraseñ|plataforma|no puedo entrar)/.test(lower)) {
    return "ACCESS_PLATFORM";
  }
  if (/(factur|administraci[oó]n|cobro|pago)/.test(lower)) {
    return "ADMIN_DERIVATION";
  }
  if (/(gps|dispositivo|seguimiento|telemetr|soporte)/.test(lower)) {
    return "GENERAL_TECH";
  }
  return "OTHER";
}

export function suggestPriority(text: string, incidentType: WaraIncidentType): "LOW" | "NORMAL" | "HIGH" | "URGENT" {
  const lower = text.toLowerCase();
  if (/(urgente|ca[ií]do|cr[ií]tico|cliente enojado|denuncia|fraude)/.test(lower)) {
    return "URGENT";
  }
  if (incidentType === "MISSING_REPORT") {
    return "HIGH";
  }
  if (/(no reporta|offline|sin señal|no actualiza|sin datos)/.test(lower)) {
    return "HIGH";
  }
  if (incidentType === "ODOMETER_CHANGE") {
    return "NORMAL";
  }
  return "NORMAL";
}

export function detectMissingData(text: string, incidentType: WaraIncidentType, companyName?: string | null) {
  const lower = text.toLowerCase();
  const plate = detectPlate(text);
  const missing: string[] = [];

  if (!plate) {
    missing.push("matrícula");
  }

  if (incidentType === "MISSING_REPORT") {
    if (!(companyName && companyName.trim()) && !/(empresa|raz[oó]n social)/.test(lower)) {
      missing.push("razón social");
    }
    if (!/(desde|hace|hora|horas|minutos|d[ií]a|dias)/.test(lower)) {
      missing.push("desde cuándo sucede");
    }
  }

  if (incidentType === "ODOMETER_CHANGE") {
    if (!/\b\d{3,7}\b/.test(lower)) missing.push("kilometraje");
    if (!/(fecha|hoy|ayer|\d{1,2}[\/-]\d{1,2})/.test(lower)) missing.push("fecha");
    if (!/(hora|\d{1,2}:\d{2})/.test(lower)) missing.push("hora");
  }

  if (incidentType === "CERTIFICATE_ISSUE") {
    if (!(companyName && companyName.trim()) && !/(empresa|raz[oó]n social)/.test(lower)) {
      missing.push("empresa");
    }
  }

  return { plate, missing };
}

export function toLegacyCategory(incidentType: WaraIncidentType): "TECH_SUPPORT" | "BILLING" | "SALES" | "OTHER" {
  if (incidentType === "ODOMETER_CHANGE") return "BILLING";
  if (incidentType === "CERTIFICATE_ISSUE") return "SALES";
  if (incidentType === "ADMIN_DERIVATION") return "OTHER";
  return "TECH_SUPPORT";
}

