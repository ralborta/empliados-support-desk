/**
 * Catálogo semántico de servicios operativos V2.
 * Precedencia: servicios > búsqueda de unidades.
 */
function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let prev = i;
    row[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cur = row[j + 1]!;
      const cost = a[i] === b[j] ? 0 : 1;
      row[j + 1] = Math.min(cur + 1, row[j]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}

export type ServiceIntent =
  | "certificate"
  | "odometer_update"
  | "horometer_update"
  | "gps_report"
  | "maintenance"
  | "ticket"
  | "human_handoff"
  | "cancel"
  | "confirmation"
  | "none";

/** Palabras que NUNCA deben tratarse como token de búsqueda de unidad. */
export const SERVICE_FILLER_WORDS = new Set([
  "certificado",
  "certficado",
  "sertificado",
  "cobertura",
  "poliza",
  "constancia",
  "comprobante",
  "monitoreo",
  "odometro",
  "horometro",
  "kilometraje",
  "kilometros",
  "mantenimiento",
  "service",
  "revision",
  "taller",
  "reclamo",
  "incidencia",
  "problema",
  "falla",
  "asesor",
  "operador",
  "persona",
]);

export function looksLikeCertificateService(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = norm(raw);
  if (/\b(odometro|horometro|mantenimiento|gps)\b/.test(t) && !/\b(certificado|cobertura|poliza|constancia|comprobante)\b/.test(t)) {
    return false;
  }
  if (
    /\b(certificado|certficado|cobertura|monitoreo|constancia|sertificado|poliza|comprobante)\b/.test(t)
  ) {
    return true;
  }
  return t
    .split(/[^a-z]+/)
    .some((word) => word.length >= 9 && word.length <= 13 && levenshtein(word, "certificado") <= 2);
}

export function looksLikeOdometerOrHorometerService(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  if (/\b(certificado|cobertura|poliza|mantenimiento)\b/.test(t)) return false;
  if (/\b(odometro|horometro|kilometraje|kilometros)\b/.test(t)) return true;
  if (/\b(actualizar|cambiar|cambia|cambiale|informar|cargar|registrar)\b/.test(t)) {
    if (/\b(km|horas?|hs)\b/.test(t)) return true;
  }
  if (/\b(horas?\s+de\s+motor|actualizar\s+horas|cambiale\s+las\s+horas)\b/.test(t)) return true;
  if (/\b(necesito\s+informar\s+(los\s+)?km|informar\s+(los\s+)?km)\b/.test(t)) return true;
  return false;
}

export function looksLikeGpsService(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  return /\b(reporte|informe|estado|gps|ubicacion|posicion|donde\s+esta|como\s+esta|ignicion|senal)\b/.test(t);
}

export function looksLikeMaintenanceService(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  if (/\b(mantenimiento|preventivo|correctivo|taller|service|revision)\b/.test(t)) return true;
  return t
    .split(/[^a-z]+/)
    .some((word) => word.length >= 10 && word.length <= 16 && levenshtein(word, "mantenimiento") <= 2);
}

export function looksLikeTicketOrHandoffService(text: string | undefined | null): boolean {
  const t = norm(String(text ?? ""));
  if (!t) return false;
  return (
    /\b(reclamo|incidencia|problema|falla|no\s+funciona|ticket)\b/.test(t) ||
    /\b(asesor|operador|persona|humano|atencion\s+humana|hablar\s+con\s+alguien)\b/.test(t)
  );
}

/** True si el mensaje es claramente un servicio/trámite, no una búsqueda de unidad. */
export function looksLikeOperationalServiceIntent(text: string | undefined | null): boolean {
  return (
    looksLikeCertificateService(text) ||
    looksLikeOdometerOrHorometerService(text) ||
    looksLikeMaintenanceService(text) ||
    looksLikeTicketOrHandoffService(text)
  );
}

export function classifyServiceIntent(text: string | undefined | null): ServiceIntent {
  const t = String(text ?? "");
  if (looksLikeCertificateService(t)) return "certificate";
  if (looksLikeOdometerOrHorometerService(t)) {
    const n = norm(t);
    if (/\bhorometro\b/.test(n) || /\bhoras?\b/.test(n)) return "horometer_update";
    return "odometer_update";
  }
  if (looksLikeMaintenanceService(t)) return "maintenance";
  if (looksLikeTicketOrHandoffService(t)) {
    const n = norm(t);
    if (/\b(asesor|operador|persona|humano|atencion\s+humana|hablar\s+con\s+alguien)\b/.test(n)) {
      return "human_handoff";
    }
    return "ticket";
  }
  if (looksLikeGpsService(t)) return "gps_report";
  return "none";
}
