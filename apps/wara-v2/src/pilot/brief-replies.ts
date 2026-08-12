/** Respuestas breves contextuales (portado mínimo de V1 wara.ts). */

function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingAffirmationPrefix(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^ahora\s+(si|sí)\s*,?\s*/i, "")
    .replace(/^(bueno|ok|dale)\s+,?\s*/i, "")
    .trim();
}

export function looksLikeBriefConfirmation(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const stripped = stripLeadingAffirmationPrefix(raw);
  const t = stripped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!t) return false;
  if (t.startsWith("conf")) return true;
  if (
    new Set([
      "si",
      "sii",
      "sip",
      "dale",
      "ok",
      "okey",
      "listo",
      "correcto",
      "deacuerdo",
      "perfecto",
    ]).has(t)
  ) {
    return true;
  }
  const normText = stripped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(no\s+es\s+correcto|no\s+confirmo|incorrecto|no\s+est[aá]\s+bien)\b/.test(normText)) {
    return false;
  }
  return (
    /\b(esa\s+(esta\s+)?(bien|es|correcta)|si\s+esa|est[aá]\s+bien|es\s+correcto|as[ií]\s+es|dale\s+esa|esa\s+misma)\b/.test(
      normText,
    ) || /\b(de\s+acuerdo|correcto\s+eso|esta\s+bien)\b/.test(normText)
  );
}

export function looksLikeBriefRejection(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n) return false;
  if (/^(no|nop|nope|nah)$/.test(n)) return true;
  return /\b(no\s+esa|otra\s+unidad|no\s+es\s+esa|incorrecto|no\s+confirmo)\b/.test(n);
}

export function looksLikeCancelTramite(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n) return false;
  return /^(cancelar|cancela|salir|abortar|detener)$/.test(n) || /\b(cancelar|anular)\s+(tramite|consulta|todo)\b/.test(n);
}

export function looksLikeChangeUnit(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n) return false;
  return /\b(otra\s+unidad|cambiar\s+unidad|otro\s+movil|otra\s+patente)\b/.test(n);
}

export function looksLikeResumeTramite(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n || n.length > 120) return false;
  if (/\b(con|en)\s+(el|la)?\s*(wara|cacique|empresa)\b/.test(n)) return false;
  return /\b(seguimos|continuamos|retomar|retomemos|seguir|continuar|donde\s+quedamos|volvamos)\b/.test(n);
}

/** Tras consulta lateral con CONFIRMO pendiente — no registrar, retomar hilo. */
export function looksLikeResumePausedTramite(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n || n.length > 80) return false;
  if (/\b(con|en|para)\s+(el|la)?\s*(cacique|wara|empresa)\b/.test(n)) return false;
  return /^(continuamos|seguimos|dale\s+seguimos|bueno\s+seguimos|retomemos|volvamos)$/i.test(n.trim()) ||
    /\b(continuemos|sigamos\s+con\s+el\s+tramite)\b/.test(n);
}

export function looksLikePendingConfirmComprehensionAck(text: string | undefined | null): boolean {
  const n = norm(String(text ?? ""));
  if (!n || n.length > 40) return false;
  if (/\?/.test(String(text ?? ""))) return false;
  return /^(ah\s+)?(entiendo|ok|okay|okey|ya)$/i.test(String(text ?? "").trim()) ||
    /^ah\s+ok$/i.test(String(text ?? "").trim());
}

/** "22", "la 22", "opción 22" — solo si hay listado vigente. */
export function parseNumericListSelection(text: string): number | null {
  const raw = text.trim();
  const m =
    raw.match(/^(?:la|el|opcion|opción)\s*(\d{1,3})$/i) ||
    raw.match(/^(\d{1,3})$/);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function looksLikeFleetListContinuation(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return (
    /^(siguiente|mas|más|continuar|ver\s+mas|ver\s+más|otra\s+pagina|otra\s+página)$/.test(n) ||
    /\b(mas\s+unidades|más\s+unidades|siguiente\s+pagina|siguiente\s+página)\b/.test(n)
  );
}

export function looksLikeFleetListBack(text: string): boolean {
  const n = norm(text);
  return /^(anterior|atras|atrás|volver|pagina\s+anterior|página\s+anterior)$/.test(n);
}

export function looksLikePlatesOnlyRequest(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  if (/\b(solo|solamente|unicamente|únicamente)\b/.test(n) && /\b(patentes?|matriculas?|matrículas?)\b/.test(n)) {
    return true;
  }
  if (/\b(lista|listame|pasame|dame)\b/.test(n) && /\b(patentes?|matriculas?|matrículas?)\b/.test(n)) {
    return !/\b(unidad|unidades|nombre|flota)\b/.test(n);
  }
  return /^(patentes|matriculas|matrículas)$/.test(n);
}

export function looksLikeGpsReportRequest(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  if (/\b(reporte|informe|estado|gps|ignicion|ignición|posicion|posición|ubicacion|ubicación|senal|señal)\b/.test(n)) {
    return true;
  }
  if (/\b(como\s+esta|donde\s+esta|como\s+está|donde\s+está)\b/.test(n)) return true;
  return false;
}

export function looksLikeGreetingOnly(text: string): boolean {
  const n = norm(text);
  return /^(hola|buenas|buen\s+dia|buenos\s+dias|menu|ayuda)$/.test(n);
}

export function looksLikeSideQueryDuringTramite(text: string): boolean {
  return (
    looksLikePlatesOnlyRequest(text) ||
    looksLikeUnitsListRequest(text) ||
    looksLikeGpsReportRequest(text)
  );
}

function looksLikeUnitsListRequest(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  if (/\b(lista|listas|listar|mostrar|ver|dame|pasame|cuales|cuantas|todas)\b/.test(n)) {
    if (/\b(unidad|unidades|movil|moviles|flota|patente|matricula|vehiculo)\b/.test(n)) {
      return true;
    }
  }
  return /^(lista|listas|unidades|flota)$/.test(n) || /\blistas?\s+de\s+unidad/.test(n);
}
