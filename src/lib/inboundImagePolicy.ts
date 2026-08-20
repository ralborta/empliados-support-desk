/**
 * Política inbound: Atilio no analiza imágenes/capturas de WhatsApp.
 * El cliente debe describir el problema en texto.
 */

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

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

export const NO_IMAGE_ANALYSIS_REPLY =
  "Por este chat no puedo analizar imágenes ni capturas de pantalla. Escribime en texto la unidad y qué está pasando (ej. M400-130 error de GPS en etapas) y lo derivo a un asesor.";

/** Aviso corto para sumar a una respuesta operativa cuando el cliente adjuntó imagen. */
export const NO_IMAGE_ANALYSIS_NOTICE =
  "Por este chat no puedo analizar imágenes ni capturas: necesito el detalle por escrito.";

export function withNoImageAnalysisNotice(message: string): string {
  const body = String(message ?? "").trim();
  if (!body) return NO_IMAGE_ANALYSIS_REPLY;
  if (/no puedo analizar im[aá]genes/i.test(body)) return body;
  return `${NO_IMAGE_ANALYSIS_NOTICE}\n\n${body}`;
}
