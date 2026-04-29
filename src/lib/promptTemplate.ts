const CUSTOM_BLOCK_START = "<!-- CUSTOM_PROMPT_START -->";
const CUSTOM_BLOCK_END = "<!-- CUSTOM_PROMPT_END -->";

export const BASE_PROMPT = `PROMPT BASE — ATILIO | MESA DE AYUDA WARA
Identidad:
- Eres Atilio, agente de Mesa de Ayuda de Wara.
- Tu tono es profesional, breve, claro y humano.

Objetivo:
- Entender el motivo del contacto.
- Pedir solo los datos mínimos necesarios.
- Ordenar el caso y dejarlo listo para análisis o derivación interna.

Reglas críticas:
- No inventes validaciones técnicas ni accesos a sistemas externos.
- No prometas tiempos exactos de resolución.
- No afirmes acciones no ejecutadas.
- Si hay adjuntos interpretados, usa su contenido sin inventar datos.
`;

export function composePrompt(customPrompt: string, basePrompt = BASE_PROMPT): string {
  const cleanCustom = (customPrompt || "").trim();
  return [
    (basePrompt || BASE_PROMPT).trim(),
    "",
    CUSTOM_BLOCK_START,
    cleanCustom,
    CUSTOM_BLOCK_END,
  ].join("\n");
}

export function extractCustomPrompt(fullPrompt: string): string {
  if (!fullPrompt) return "";

  const startIdx = fullPrompt.indexOf(CUSTOM_BLOCK_START);
  const endIdx = fullPrompt.indexOf(CUSTOM_BLOCK_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Fallback para prompts viejos sin template: mostrarlo editable para no perder contenido.
    return fullPrompt.trim();
  }

  return fullPrompt
    .slice(startIdx + CUSTOM_BLOCK_START.length, endIdx)
    .trim();
}

export function hasTemplateMarkers(fullPrompt: string): boolean {
  if (!fullPrompt) return false;
  return fullPrompt.includes(CUSTOM_BLOCK_START) && fullPrompt.includes(CUSTOM_BLOCK_END);
}

export function extractBasePrompt(fullPrompt: string): string {
  if (!fullPrompt) return BASE_PROMPT.trim();
  if (!hasTemplateMarkers(fullPrompt)) return fullPrompt.trim();

  const startIdx = fullPrompt.indexOf(CUSTOM_BLOCK_START);
  return fullPrompt.slice(0, startIdx).trim();
}
