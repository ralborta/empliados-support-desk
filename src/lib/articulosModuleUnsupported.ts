/**
 * Módulo Artículos (stock / remitos / inventario) — sin corpus KB en V1.
 * Evita que el bot ofrezca Mantenimiento/Combustible/Cisternas ante esa consulta.
 */

function normArticulosQuery(raw: string | undefined | null): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Consulta del módulo Artículos (plataforma), no “artículos” de una tarea de mantenimiento.
 */
export function looksLikeArticulosModuleUnsupportedQuery(
  raw: string | undefined | null,
): boolean {
  const t = normArticulosQuery(raw);
  if (!t || t.length > 280) return false;

  // Piezas/repuestos en contexto de tarea/OT/plan → Mantenimiento, no módulo Artículos.
  const mtSpareParts =
    /\b(tarea|ot\b|orden(es)?\s+de\s+trabajo|plan\s+(preventivo|correctivo)|administrar\s+tarea|confirmar\s+(movimientos|realizacion))\b/.test(
      t,
    ) && /\barticulos?\b/.test(t);
  if (mtSpareParts && !/\bmodulo\b/.test(t)) return false;

  if (/\bmodulo\s+(de\s+)?articulos?\b/.test(t)) return true;
  if (/\barticulos?\s+v2\b/.test(t)) return true;
  if (/\b(stock|inventario|remitos?)\b/.test(t) && /\barticulos?\b/.test(t)) return true;
  if (/\bes el (modulo )?de articulos?\b/.test(t)) return true;
  if (/^(el )?de articulos?[\s!.,]*$/.test(t)) return true;
  if (/^(modulo )?articulos?( de (stock|inventario|wara))?[\s!.,]*$/.test(t)) return true;
  return false;
}

/** Límite de canal honesto: sin inventar otro módulo. */
export function buildArticulosModuleUnsupportedReply(): string {
  return [
    "Por este chat todavía no tengo una guía del módulo *Artículos* (stock / remitos / inventario).",
    "Si lo que necesitás es ese módulo, no te oriento con Mantenimiento, Combustible ni Cisternas.",
    "Pedí un asesor y te derivo, o contame otro módulo que sí pueda guiarte (Unidades, Mantenimiento, Transporte, Hojas de ruta, etc.).",
  ].join("\n");
}
