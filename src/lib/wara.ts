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

const PLATE_REGEX_GLOBAL =
  /\b([A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})\b/gi;

/**
 * Patentes de EJEMPLO que aparecen en los textos del bot ("ej: AB123CD", "por
 * ejemplo AA123BB"). Nunca son patentes reales del cliente; deben ignorarse al
 * detectar la patente desde el historial, o se intentaría operar sobre un
 * vehículo inexistente (Wara responde "No se encontró el vehículo con esa patente").
 */
export const EXAMPLE_PLATES = new Set([
  "AB123CD",
  "AA123BB",
  "AA999AA",
  "ABC123",
  "AAA123",
]);

export function normalizePlate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.toUpperCase().replace(/\s+/g, "");
}

/** True si la patente normalizada es una de las usadas como ejemplo en los prompts. */
export function isExamplePlate(value: string | null | undefined): boolean {
  const compact = normalizePlate(value);
  return compact ? EXAMPLE_PLATES.has(compact) : false;
}

/**
 * Detecta la primera patente REAL en el texto, ignorando las patentes de ejemplo
 * de los prompts. Si solo hay ejemplos, devuelve null.
 */
export function detectPlate(text: string): string | null {
  if (!text) return null;
  for (const match of text.matchAll(PLATE_REGEX_GLOBAL)) {
    const plate = normalizePlate(match[1]);
    if (plate && !EXAMPLE_PLATES.has(plate)) return plate;
  }
  return null;
}

/** Líneas del bot con ejemplos de flota; no usar sus patentes como intención del cliente. */
export function lineLooksLikeBotUnitListExample(line: string): boolean {
  const l = line.trim();
  if (!l) return false;
  return (
    /Ten[eé]s \d+ unidades/i.test(l) ||
    /Decime una patente puntual/i.test(l) ||
    /Algunas:/i.test(l) ||
    / y \d+ m[aá]s\.\s*Decime/i.test(l)
  );
}

/**
 * Última patente real mencionada en el hilo (resúmenes del bot, "unidad XX", o patente suelta).
 * Ignora patentes de ejemplo de los prompts y patentes solo citadas en listados de ejemplo del bot.
 */
export function extractLastPlateFromThread(text: string): string | null {
  if (!text?.trim()) return null;
  const lines = text.split("\n");

  for (let li = lines.length - 1; li >= 0; li--) {
    const line = lines[li];
    if (lineLooksLikeBotUnitListExample(line)) continue;
    const labeled = [
      ...line.matchAll(/(?:Patente|Matr[ií]cula)[^\n:]*[:\-]\s*([A-Za-z0-9 ]{5,12})/gi),
    ];
    for (let i = labeled.length - 1; i >= 0; i--) {
      const plate = normalizePlate(labeled[i][1]);
      if (plate && !isExamplePlate(plate)) return plate;
    }
    const unitMention = [...line.matchAll(/unidad\s+([A-Za-z0-9 ]{5,12})/gi)];
    for (let i = unitMention.length - 1; i >= 0; i--) {
      const plate = normalizePlate(unitMention[i][1]);
      if (plate && !isExamplePlate(plate)) return plate;
    }
    const plate = detectPlate(line);
    if (plate) return plate;
  }
  return null;
}

/** El bot acaba de pedir patente para un trámite operativo de mantenimiento. */
export function hasPendingMaintenancePlateRequest(threadText: string): boolean {
  const tail = threadText.slice(-2500).toLowerCase();
  return (
    /para programar mantenimiento preventivo necesito la patente/.test(tail) ||
    /para registrar el mantenimiento necesito la patente/.test(tail) ||
    (/necesito la patente de la unidad/.test(tail) && /mantenimiento/.test(tail))
  );
}

/** Ignora mensajes anteriores al último cambio/selección de empresa en el hilo. */
export function threadTextSinceCompanySelection(text: string): string {
  const lines = text.split("\n");
  let cut = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /Listo, reinici[eé] la empresa/i.test(line) ||
      /Perfecto, sigo con/i.test(line) ||
      /Est[aá]s operando con/i.test(line) ||
      /asociado a m[aá]s de una empresa/i.test(line)
    ) {
      cut = i;
    }
  }
  return lines.slice(cut).join("\n");
}

/**
 * Formatea una patente argentina con espacios, como Wara espera recibirla:
 *   - Formato Mercosur: "AD 427 MC" (2 letras + 3 dígitos + 2 letras)
 *   - Formato anterior: "ABC 123"   (3 letras + 3 dígitos)
 * Si no matchea ninguno de los dos formatos, devuelve la patente normalizada
 * (sin espacios) tal cual.
 */
export function formatPlateWithSpaces(value: string | null | undefined): string | null {
  const compact = normalizePlate(value);
  if (!compact) return null;
  const mercosur = compact.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
  if (mercosur) return `${mercosur[1]} ${mercosur[2]} ${mercosur[3]}`;
  const legacy = compact.match(/^([A-Z]{3})(\d{3})$/);
  if (legacy) return `${legacy[1]} ${legacy[2]}`;
  return compact;
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
    missing.push("patente");
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

