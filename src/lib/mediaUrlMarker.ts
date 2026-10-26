export type ExtractedMediaUrl = {
  mediaUrl?: string;
  text: string;
};

const MEDIA_URL_MARKER_PREFIX = "[[MEDIA_URL]]";
const MEDIA_URL_MARKER_SUFFIX = "[[/MEDIA_URL]]";

/**
 * Inserta una línea al inicio del texto para que el runtime pueda enviar un `mediaUrl`
 * sin cambiar todas las estructuras de retorno.
 */
export function withMediaUrlMarker(text: string, mediaUrl?: string | null): string {
  if (!mediaUrl) return text;
  const safeUrl = String(mediaUrl).trim();
  if (!/^https?:\/\//i.test(safeUrl)) return text;
  return `${MEDIA_URL_MARKER_PREFIX}${safeUrl}${MEDIA_URL_MARKER_SUFFIX}\n${text}`;
}

/**
 * Extrae el `mediaUrl` (si existe) y devuelve el texto limpio (sin el marcador).
 * Solo contempla marcador al inicio para evitar falsos positivos.
 */
export function extractMediaUrlAndCleanText(text: string | undefined | null): ExtractedMediaUrl {
  const t = String(text ?? "");
  const m = t.match(/^\[\[MEDIA_URL\]\](.+?)\[\[\/MEDIA_URL\]\]\s*\n?/);
  if (!m) return { text: t };

  const url = m[1]?.trim();
  const clean = t.slice(m[0].length);

  if (!url || !/^https?:\/\//i.test(url)) return { text: clean };
  return { mediaUrl: url, text: clean.trimStart() };
}

