/**
 * Política inbound de imágenes WhatsApp.
 *
 * Preferencia: si BBC manda {aiImage} (interpretImage), usamos esa descripción
 * como texto del turno. Si no hay descripción usable, pedimos detalle por escrito.
 */

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefijo interno cuando el turno incorpora la descripción multimodal de BBC. */
export const AI_IMAGE_CONTEXT_PREFIX = "[Descripción de imagen]";

/** Evento BBC de media sin caption útil (_event_image__, etc.). */
export function looksLikeInboundMediaOnlyEvent(text: string | undefined | null): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (/^_event_(image|document|video)__/i.test(t)) return true;
  if (/^\[archivo adjunto\]$/i.test(t)) return true;
  return false;
}

/** El cliente indica que adjuntó imagen/captura (con o sin detalle escrito). */
export function looksLikeCustomerImageAttachmentCue(text: string | undefined | null): boolean {
  const n = norm(text ?? "");
  if (!n || n.length > 400) return false;
  return (
    /\b(adjunto|adjuntos|adjunto\s+imagen|adjunto\s+captura|adjunto\s+foto|adjunto\s+screenshot)\b/.test(
      n,
    ) ||
    /\b(te\s+mando|te\s+envio|te\s+env[ií]o|mando|envio|env[ií]o)\b.{0,30}\b(imagen|imagenes|captura|capturas|foto|fotos|screenshot|pantalla)\b/.test(
      n,
    ) ||
    /\b(imagen|imagenes|captura|capturas|foto|fotos)\s+(adjunt|anex)/.test(n)
  );
}

/** True si el texto del turno ya incluye descripción de imagen (p. ej. de {aiImage}). */
export function selectionHasAiImageContext(text: string | undefined | null): boolean {
  return String(text ?? "").includes(AI_IMAGE_CONTEXT_PREFIX);
}

export function hasUsableAiImageDescription(aiImage: string | undefined | null): boolean {
  const t = String(aiImage ?? "").trim();
  if (!t) return false;
  if (/^\{aiImage\}$/i.test(t)) return false;
  if (t.length < 8) return false;
  return true;
}

/**
 * Combina body del mensaje con la descripción multimodal de BBC ({aiImage}).
 * Si solo llega el evento de media, la descripción pasa a ser el texto del turno.
 */
export function mergeInboundTextWithAiImage(
  body: string | undefined | null,
  aiImage: string | undefined | null,
): string {
  const raw = String(body ?? "").trim();
  if (!hasUsableAiImageDescription(aiImage)) return raw;
  const desc = String(aiImage).trim();
  if (selectionHasAiImageContext(raw)) return raw;
  if (raw.includes(desc.slice(0, Math.min(48, desc.length)))) return raw;
  if (looksLikeInboundMediaOnlyEvent(raw) || !raw) {
    return `${AI_IMAGE_CONTEXT_PREFIX}\n${desc}`;
  }
  return `${raw}\n\n${AI_IMAGE_CONTEXT_PREFIX}\n${desc}`;
}

export const NO_IMAGE_ANALYSIS_REPLY =
  "No pude leer la imagen automáticamente por este chat. Escribime la unidad (patente, interno o M400-105) y qué está pasando; con eso reviso el estado GPS o derivo si hace falta.";

/** Aviso corto cuando adjuntó imagen pero no hubo descripción usable de BBC. */
export const NO_IMAGE_ANALYSIS_NOTICE =
  "No pude leer la captura automáticamente: necesito el detalle por escrito.";

export function withNoImageAnalysisNotice(message: string): string {
  const body = String(message ?? "").trim();
  if (!body) return NO_IMAGE_ANALYSIS_REPLY;
  if (/no pude leer (la imagen|la captura)|no puedo analizar im[aá]genes/i.test(body)) return body;
  return `${NO_IMAGE_ANALYSIS_NOTICE}\n\n${body}`;
}
