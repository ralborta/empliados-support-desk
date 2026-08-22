/**
 * Routing GPS: unidad resoluble → telemetría primero; plataforma UI después del assessment.
 * Sin importar waraUnitIntent/waraApi (evita ciclos).
 */
import { detectLoosePlate, isPlausibleVehiclePlate, normalizePlate } from "@/lib/wara";
import { extractEmbeddedNumericReferences } from "@/lib/unitReferenceParser";

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeUnitNameCode(text: string): boolean {
  return /\b(?:M?\d{3}-\d{2,3})\b/i.test(text);
}

/** Referencia de unidad identificable en el mensaje (sin validar flota). */
export function looksLikeResolvableUnitReferenceInMessage(
  text: string | undefined | null,
): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const plate = detectLoosePlate(raw);
  if (plate && isPlausibleVehiclePlate(normalizePlate(plate))) return true;
  if (looksLikeUnitNameCode(raw)) return true;
  if (/\binterno\s+(?:M|m)?\d{3}-\d{2,3}\b/i.test(raw)) return true;
  if (/\bunida[d]?\s+(?:M|m)?\d{3}-\d{2,3}\b/i.test(raw)) return true;
  if (/\binterno\b/i.test(raw) && extractEmbeddedNumericReferences(raw).length > 0) {
    return true;
  }
  const bare = raw.replace(/\s+/g, "");
  if (/^\d{5,7}$/.test(bare)) return true;
  return false;
}

/** Síntoma operativo de telemetría (no UI de etapas/historial). */
export function looksLikeOperationalTelemetrySymptom(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n) return false;
  if (looksLikeGpsPlatformUiSymptomOnly(text)) return false;
  return (
    /\b(no reporta|no me reporta|sin reporte|falta de reporte|dejo de reportar|offline|sin se[nñ]al|sin senal)\b/.test(
      n,
    ) ||
    /\b(falla de ignicion|falla ignicion|ignicion apagada|no enciende)\b/.test(n) ||
    (/\b(gps|reporte|telemetria)\b/.test(n) &&
      /\b(falla|problema|error|no anda|no funciona)\b/.test(n))
  );
}

/**
 * Reclamo de funcionalidad de plataforma (etapas/historial/cumplimiento en UI),
 * no falta de reporte satelital por sí sola.
 */
export function looksLikeGpsPlatformUiSymptomOnly(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n || n.length > 500) return false;
  const platformCue =
    /\b(etapas?\s+de\s+la\s+vuelta|etapas?\s+de\s+vuelta|cumplimiento\s+de\s+etapas?|historial|recorrido)\b/.test(
      n,
    ) ||
    (/\bvuelta\b/.test(n) && /\b(etapas?|cumplimiento|historial|recorrido)\b/.test(n)) ||
    /\b(no\s+muestra|no\s+figura|no\s+aparece|no\s+veo|no\s+revisa|tampoco\s+revisa)\b.{0,40}\b(etapas?|historial|recorrido|cumplimiento)\b/.test(
      n,
    ) ||
    /\b(etapas?|historial|recorrido|cumplimiento)\b.{0,40}\b(no\s+muestra|no\s+figura|no\s+aparece|no\s+veo)\b/.test(
      n,
    );
  const problemCue =
    /\b(no\s+reporta|no\s+muestra|no\s+aparece|no\s+figura|no\s+veo|no\s+revisa|tampoco\s+revisa|sin\s+reporte|falta|falla|problema|error|no\s+anda|no\s+funciona)\b/.test(
      n,
    );
  return platformCue && problemCue;
}

function looksLikeGpsStatusConsultCue(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return (
    /\b(estado|reporte|gps|ignicion|posicion|ubicacion|ultimo reporte|como esta|como está)\b/.test(
      n,
    ) && /\b(unidad|patente|interno|flota)\b/.test(n)
  );
}

/**
 * Unidad en mensaje + síntoma GPS/telemetría → consultar unidades (telemetría) antes de asesor.
 */
export function shouldRouteGpsConsultToUnidades(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (!looksLikeResolvableUnitReferenceInMessage(raw)) return false;
  const n = norm(raw);
  return (
    looksLikeOperationalTelemetrySymptom(raw) ||
    looksLikeGpsPlatformUiSymptomOnly(raw) ||
    looksLikeGpsStatusConsultCue(raw) ||
    /\b(estado|gps|reporte|telemetria|ignicion|etapas?|historial|recorrido|cumplimiento|vuelta)\b/.test(
      n,
    )
  );
}

/** Extrae candidatos de unidad desde descripción de imagen ({aiImage}). No confiable para escrituras. */
export function extractUnitCandidatesFromVisionText(
  text: string | undefined | null,
  max = 10,
): string[] {
  const raw = sanitizeVisionDescriptionForRouting(String(text ?? ""));
  if (!raw.trim()) return [];
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t) && out.length < max) out.push(t);
  };
  for (const m of raw.matchAll(/\b(M\d{3}-\d{2,3})\b/gi)) push(m[1].toUpperCase());
  for (const m of raw.matchAll(/\binterno\s+(M?\d{3}-\d{2,3})\b/gi)) push(m[1].toUpperCase());
  for (const m of raw.matchAll(/\bunida[d]?\s+(\d{5,7})\b/gi)) push(m[1]);
  return out;
}

/** Ignorar instrucciones embebidas en descripciones de imagen (no confiable). */
export function sanitizeVisionDescriptionForRouting(text: string): string {
  return String(text ?? "")
    .replace(/\b(abr[ií]|crea|genera|levanta)\b.{0,30}\b(ticket|caso|reclamo)\b/gi, "")
    .replace(/\b(ignora|olvida|haz|hace)\b.{0,40}$/gim, "")
    .trim();
}
