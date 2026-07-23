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
  /\b([A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}|[A-Z]{3}[\s-]?\d{3}|[A-Z]{3}[\s-]?\d{4})\b/gi;

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
  return value
    .toUpperCase()
    .replace(/[\s\-_.]+/g, "");
}

/** True si la patente normalizada es una de las usadas como ejemplo en los prompts. */
export function isExamplePlate(value: string | null | undefined): boolean {
  const compact = normalizePlate(value);
  return compact ? EXAMPLE_PLATES.has(compact) : false;
}

/** Patente real (Mercosur o formato anterior), no texto coloquial tipo "para actuali". */
export function isPlausibleVehiclePlate(value: string | null | undefined): boolean {
  const compact = normalizePlate(value);
  if (!compact || compact.length < 5 || compact.length > 9) return false;
  if (!/\d/.test(compact)) return false;
  if (isExamplePlate(compact)) return false;
  const letters = compact.match(/^[A-Z]+/)?.[0] ?? "";
  if (letters.length === 3 && PLATE_STOPWORDS.has(letters)) return false;
  return (
    /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(compact) ||
    /^[A-Z]{3}\d{3}$/.test(compact) ||
    /^[A-Z]{3}\d{4}$/.test(compact)
  );
}

/**
 * Detecta la primera patente REAL en el texto, ignorando las patentes de ejemplo
 * de los prompts. Si solo hay ejemplos, devuelve null.
 */
const PLATE_STOPWORDS = new Set(["DEL", "LOS", "LAS", "UNA", "UNO", "CON", "POR", "SUS"]);

export function detectPlate(text: string): string | null {
  if (!text) return null;
  for (const match of text.matchAll(PLATE_REGEX_GLOBAL)) {
    const plate = normalizePlate(match[1]);
    if (!plate || EXAMPLE_PLATES.has(plate)) continue;
    const letters = plate.match(/^[A-Z]+/)?.[0] ?? "";
    if (letters.length === 3 && PLATE_STOPWORDS.has(letters)) continue;
    return plate;
  }
  return null;
}

/** Mensaje corto que parece ser solo una patente (ej. "Lwk7902"). */
export function looksLikePlateOnlyMessage(text: string): boolean {
  const compact = (text ?? "").trim().replace(/[\s\-_.]+/g, "");
  if (!compact || compact.length < 5 || compact.length > 12) return false;
  if (!/^[A-Za-z0-9-]+$/.test(compact)) return false;
  if (!/\d/.test(compact)) return false;
  const norm = normalizePlate(compact);
  return !!(norm && !isExamplePlate(norm));
}

/** Prefijo suelto de patente (NKL, HEJ, AG) sin ser patente completa. */
export function isBarePlatePrefixHint(text: string | undefined | null): boolean {
  const stripped = String(text ?? "")
    .trim()
    .replace(/^(la|el|esa|ese)\s+/i, "");
  const compact = stripped.replace(/[\s\-_.]+/g, "").toUpperCase();
  if (!/^[A-Z]{2,3}\d{0,4}$/.test(compact)) return false;
  return !isPlausibleVehiclePlate(compact);
}

/** Prefijo de patente en frases como "la AD", "la que comienza con AG", "empieza con NKL". */
export function extractPlatePrefixFromMessage(rawText: string | undefined | null): string | null {
  const norm = String(rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return null;

  const correctionHint = extractPlateCorrectionHint(rawText);
  if (correctionHint) {
    const compact = correctionHint.replace(/\s+/g, "").toUpperCase();
    if (compact.length <= 6 && !isPlausibleVehiclePlate(compact)) return compact;
  }

  if (isBarePlatePrefixHint(rawText)) {
    return String(rawText ?? "")
      .trim()
      .replace(/^(la|el|esa|ese)\s+/i, "")
      .replace(/[\s\-_.]+/g, "")
      .toUpperCase();
  }

  const laQue = norm.match(
    /\b(?:la|el|esa|ese)\s+(?:q|que)\s+(?:empieza|empiezan|comienza|comienzan)\s+con\s+([a-z0-9]{2,6})\b/,
  );
  if (laQue?.[1]) return laQue[1].replace(/\s+/g, "").toUpperCase();

  const explicit = norm.match(/(?:empieza|empiezan|comienza|comienzan)\s+con\s+([a-z0-9]{2,6})/i);
  if (explicit?.[1]) return explicit[1].replace(/\s+/g, "").toUpperCase();

  const laPrefix = norm.match(/\b(?:la|el|esa|ese)\s+([a-z]{2,3}\d{0,3})\b/);
  if (laPrefix?.[1]) {
    const hint = laPrefix[1].replace(/\s+/g, "").toUpperCase();
    if (!isPlausibleVehiclePlate(hint)) return hint;
  }

  const paraPatente = norm.match(/\bpatente\b\s+([a-z0-9]{2,6})\b/i);
  if (paraPatente?.[1]) return paraPatente[1].replace(/\s+/g, "").toUpperCase();

  return null;
}

/** Patente en el mensaje actual, incluyendo formatos viejos (LWK7902) y respuestas sueltas. */
export function detectLoosePlate(text: string): string | null {
  const fromRegex = detectPlate(text);
  if (fromRegex) return fromRegex;
  if (looksLikePlateOnlyMessage(text)) {
    return normalizePlate(text);
  }
  return null;
}

function isLikelyPlateOrPrefixToken(hint: string): boolean {
  const token = hint.replace(/\s+/g, "").toUpperCase();
  if (!token || token.length < 2) return false;
  if (isPlausibleVehiclePlate(token)) return true;
  if (isBarePlatePrefixHint(token)) return true;
  if (/^[A-Z]{2,3}\d{0,4}$/.test(token)) return true;
  return false;
}

/** Extrae patente o prefijo indicado en una corrección ("no la LWK", "no para la patente LW"). */
export function extractPlateCorrectionHint(text: string | undefined | null): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const norm = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (
    /\bconf\w*gura\w*\b/.test(norm) &&
    /\b(aenda|agenda|contacto|contactos|opciones|perfil|perfiles|usuario|usuarios)\b/.test(norm)
  ) {
    return null;
  }

  const patterns = [
    /\bpatente\s+(?:de|del)\s+(?:la\s+|el\s+|los\s+|las\s+)?([a-z]{3,20})\b/i,
    /\b(?:de la|para la)\b\s+([a-z0-9]{2,12})\b/i,
    /\bno\b.{0,12}\bpara\b.{0,12}\bla\b\s+([a-z0-9]{2,12})\b/i,
    /\bno\b.{0,16}\bla\b\s+([a-z0-9]{2,12})\b/i,
    /\bno\b.{0,12}\bpara\b.{0,20}\bpatente\b\s+([a-z0-9]{2,9})\b/i,
    /\b(?:patente|matricula)\b\s+(?!de\b|del\b)([a-z0-9]{2,9})\b/i,
    /\bla\b\s+([a-z]{2,3}\d{3,4}[a-z]{0,2})\b/i,
  ];
  for (const re of patterns) {
    const m = norm.match(re);
    if (m?.[1]) {
      const hint = m[1].replace(/\s+/g, "").toUpperCase();
      if (hint.length >= 2 && isLikelyPlateOrPrefixToken(hint)) return hint;
      if (
        hint.length >= 3 &&
        !/^(CORRECTA|OTRA|OTRO|ESA|ESE|LA|EL|MIS|UNA|ESA|ESO)$/.test(hint)
      ) {
        return hint;
      }
    }
  }

  const loose = detectLoosePlate(raw);
  if (loose) return loose;

  if (isBarePlatePrefixHint(raw)) {
    return String(raw ?? "")
      .trim()
      .replace(/^(la|el|esa|ese)\s+/i, "")
      .replace(/[\s\-_.]+/g, "")
      .toUpperCase();
  }
  return null;
}

/** Resumen de odómetro pendiente de confirmación (ChatPDF o backend). */
export function hasPendingOdometerConfirmation(threadText: string): boolean {
  const tail = threadText.slice(-2500).toLowerCase();
  if (/listo,\s*registr[eé]|registr[eé] el cambio/.test(tail)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  return (
    /voy a registrar:/.test(tail) &&
    /od[oó]metro/.test(tail) &&
    /respond[eé]\s+confirmo/.test(tail)
  );
}

/**
 * El cliente siguió con otra cosa (guía Opciones/Unidades, etc.) después de un odómetro a medias.
 * El hilo conserva contexto pero el trámite queda abandonado.
 */
export function isOdometerFlowSuperseded(threadText: string): boolean {
  if (!threadText.trim()) return false;
  const lower = threadText.toLowerCase();
  const markers = [
    lower.lastIndexOf("voy a registrar:"),
    lower.lastIndexOf("cuál es el nuevo odómetro"),
    lower.lastIndexOf("cual es el nuevo odometro"),
    lower.lastIndexOf("nuevo odómetro en km"),
    lower.lastIndexOf("nuevo odometro en km"),
    lower.lastIndexOf("perfecto, tomo "),
  ].filter((i) => i >= 0);
  if (markers.length === 0) return false;
  const cutIdx = Math.max(...markers);
  const afterMarkerBlock = threadText.slice(cutIdx);
  // Trámite ya registrado con éxito: no bloquear nuevas consultas de odómetro por temas posteriores.
  if (/listo,\s*registr[eé]|registr[eé] el cambio para la unidad/i.test(afterMarkerBlock)) {
    return false;
  }
  const after = threadText.slice(cutIdx + 80).toLowerCase();
  if (!after.trim()) return false;
  return (
    /(modulo opciones|entra a opciones|ingresa a opciones|agenda de contactos|agregar contacto|sum[aá]s un nuevo contacto|mis atajos|modulo unidades|modulo de unidades)/.test(
      after,
    ) ||
    /\b(certificado|cobertura|monitoreo|constancia)\b/.test(after) ||
    /\b(necesito|quiero|pedir|solicitar)\b/.test(after) ||
    /\bde nada\b/.test(after) ||
    (/1\.\s*(entra|ingresa|abri)/.test(after) &&
      /(agenda|opciones|contacto|unidades|grupo)/.test(after))
  );
}

/** Trámite de odómetro activo en el hilo (pide patente/km o confirmación pendiente). */
export function threadHasActiveOdometerFlow(threadText: string): boolean {
  if (isOdometerFlowSuperseded(threadText)) return false;
  return threadAwaitingOdometerPlate(threadText) || hasPendingOdometerConfirmation(threadText);
}

/** El hilo reciente está pidiendo patente para un trámite de odómetro. */
export function threadAwaitingOdometerPlate(threadText: string): boolean {
  const tail = threadText.slice(-2500).toLowerCase();
  if (hasPendingOdometerConfirmation(threadText)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  // Solo cuando el BOT pidió patente/odómetro en el turno anterior — no el intent del cliente.
  return (
    /perfecto, tomo .+ cu[aá]l es el nuevo od[oó]metro/i.test(tail) ||
    /cu[aá]l es el nuevo valor de od[oó]metro/i.test(tail) ||
    /nuevo od[oó]metro en km/i.test(tail) ||
    /(?:entendido|correcta)\.{0,3}\s*(?:cu[aá]l es|decime|pas[aá]me).{0,80}(?:patente|matr[ií]cula|marca|nombre)/i.test(
      tail,
    ) ||
    (/(?:cu[aá]l es|indic[aá]me|pas[aá]me|decime|necesito).{0,100}(?:patente|matr[ií]cula)/i.test(tail) &&
      /od[oó]metro|hor[oó]metro|kilometraje/i.test(tail) &&
      /(?:atilio|registrar el cambio|nuevo od[oó]metro)/i.test(tail))
  );
}

/** Cliente inicia trámite de odómetro/horómetro sin dar patente todavía. */
export function looksLikeOdometerIntentStart(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (detectLoosePlate(raw) || detectPlate(raw)) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(actualizar|cambiar|cambio de|corregir|ajustar|registrar)\b/.test(t) &&
    /\b(od[oó]metro|hor[oó]metro|kilometraje|kil[oó]metros)\b/.test(t)
  );
}

/** Reporte de falla/desfase del odómetro — no es trámite de actualizar km. */
export function looksLikeOdometerProblemReport(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!/\b(od[oó]metro|hor[oó]metro|kilometraje)\b/.test(t)) return false;
  if (
    /\b(actualizar|cambiar|cambio de|registrar|nuevo od[oó]metro|confirmo)\b/.test(t) &&
    !/\b(problema|problemas|no marca|marcando|incorrecto|falla|mal)\b/.test(t)
  ) {
    return false;
  }
  return (
    /\b(problema|problemas|no marca|no marcan|marcando mal|marca mal|no est[aá] marcando|incorrecto|desfasado|no coincide|no funciona|falla|aver[ií]a|revisar|arreglar)\b/.test(
      t,
    ) || /\btengo un problema\b/.test(t)
  );
}

/** Ayuda para actualizar odómetro (sin reporte de falla). */
export function looksLikeOdometerHelpRequest(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (detectLoosePlate(raw) || detectPlate(raw)) return false;
  if (looksLikeOdometerProblemReport(raw)) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!/\b(od[oó]metro|hor[oó]metro|kilometraje)\b/.test(t)) return false;
  return (
    /\b(ayuda|ayudame|ayudar)\b/.test(t) ||
    /\b(me ayudas|me pod[eé]s ayudar|podes ayudar|pod[eé]s ayudar|necesito ayuda)\b/.test(t) ||
    /\b(con mi|con el|con la)\b/.test(t)
  );
}

/** Mensaje actual pide trámite de actualización de odómetro (no guía ni otro módulo). */
export function looksLikeExplicitOdometerUpdateRequest(text: string | undefined | null): boolean {
  if (looksLikeOdometerProblemReport(text)) return false;
  return looksLikeOdometerIntentStart(text) || looksLikeOdometerHelpRequest(text);
}

export function looksLikeOdometerFlowStart(text: string | undefined | null): boolean {
  return looksLikeOdometerIntentStart(text) || looksLikeOdometerHelpRequest(text);
}
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
      if (plate && isPlausibleVehiclePlate(plate)) return plate;
    }
    const unitMention = [...line.matchAll(/unidad\s+([A-Za-z0-9 ]{5,12})/gi)];
    for (let i = unitMention.length - 1; i >= 0; i--) {
      const plate = normalizePlate(unitMention[i][1]);
      if (plate && isPlausibleVehiclePlate(plate)) return plate;
    }
    const plate = detectPlate(line);
    if (plate && isPlausibleVehiclePlate(plate)) return plate;
  }
  return null;
}

/** El bot acaba de pedir patente para un trámite operativo de mantenimiento. */
export function hasPendingMaintenancePlateRequest(threadText: string): boolean {
  const tail = threadText.slice(-2500).toLowerCase();
  const askedForPlate =
    /para programar mantenimiento preventivo necesito la patente/.test(tail) ||
    /para registrar el mantenimiento necesito la patente/.test(tail) ||
    /necesito la patente de la unidad/.test(tail) ||
    /decime la patente de la unidad/.test(tail) ||
    (/patente de la unidad/.test(tail) && /preventivo o correctivo/.test(tail)) ||
    (/yo lo dejo cargado en wara/.test(tail) && /patente/.test(tail)) ||
    (/puedo registrar o programar un mantenimiento/.test(tail) && /patente/.test(tail));
  return askedForPlate && /mantenimiento/.test(tail);
}

export type CertificateFlowState = "awaiting_unit" | "awaiting_confirm" | "none";

/** Estado del trámite de certificado según mensajes recientes del hilo. */
export function certificateFlowState(threadText: string): CertificateFlowState {
  const lines = threadText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return "none";

  const tail = lines.slice(-12).join("\n").toLowerCase();

  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
    if (/^(no|nop|nope|incorrecto|mal|otra|otro)[\s!.?]*$/i.test(lines[i])) {
      const prev = lines.slice(Math.max(0, i - 8), i).join("\n").toLowerCase();
      if (/voy a generar el certificado de cobertura/.test(prev)) {
        return "awaiting_unit";
      }
    }
  }

  // El resumen del bot es multilínea (Patente / Empresa / CONFIRMO en líneas distintas).
  if (
    /voy a generar el certificado de cobertura/.test(tail) &&
    /responde\s+confirmo/.test(tail)
  ) {
    return "awaiting_confirm";
  }
  if (/para el certificado de cobertura necesito la unidad/.test(tail)) {
    return "awaiting_unit";
  }
  return "none";
}

export function hasPendingCertificateConfirmation(threadText: string): boolean {
  return certificateFlowState(threadText) === "awaiting_confirm";
}

function normThreadText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function hasPendingMantenimientoConfirmation(threadText: string): boolean {
  const tail = normThreadText(threadText.slice(-4000));
  if (/deje registrada|registro registrado|mantenimiento registrado|listo,\s*registr/.test(tail.slice(-800))) {
    return false;
  }
  const summaryStart = tail.lastIndexOf("voy a registrar:");
  if (summaryStart === -1) return false;
  const block = tail.slice(summaryStart, summaryStart + 1200);
  if (/odometro|horometro|kilometraje/.test(block)) return false;
  return /tipo:/.test(block) && /responde\s+confirmo/.test(block);
}

/**
 * El cliente cambió de tema (GPS, certificado, saludo, etc.) tras un trámite de mantenimiento.
 * Similar a isOdometerFlowSuperseded: el hilo conserva contexto pero el trámite queda abandonado.
 */
export function isMaintenanceFlowSuperseded(
  threadText: string,
  currentText?: string | null,
): boolean {
  if (!threadText.trim()) return false;
  const current = normThreadText(String(currentText ?? "").trim());
  if (current) {
    if (
      /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal)$/.test(
        current.replace(/\s+/g, " "),
      )
    ) {
      return hasPendingMantenimientoConfirmation(threadText);
    }
    const gpsUnitCue =
      /\b(gps|ignicio|ignicion|reporte|offline|ubicacion|posicion|senal|voltaje|marcado|instalado|dispositivo|equipo)\b/.test(
        current,
      );
    const questionCue =
      /\b(como|donde|que|cual|cuando|saber|verificar|revisar|chequear|esta bien|funciona|ver|consultar|mostrar)\b/.test(
        current,
      ) || current.includes("?");
    const liveUnitAsk =
      /\b(quiero|necesito|dame|decime|pasame)\b/.test(current) &&
      /\b(ignicio|ignicion|reporte|gps|unidad)\b/.test(current);
    const notMaint = !/\b(mantenimiento|preventiv\w*|correctiv\w*|tarea|plan)\b/.test(current);
    if ((gpsUnitCue && questionCue && notMaint) || (liveUnitAsk && notMaint)) return true;
    if (
      notMaint &&
      /\b(certificado|cobertura|odometro|horometro|agenda|opciones|usuarios|listado|mis unidades)\b/.test(
        current,
      )
    ) {
      return true;
    }
  }

  const lower = normThreadText(threadText);
  const markers = [
    lower.lastIndexOf("voy a registrar:"),
    lower.lastIndexOf("decime la patente de la unidad"),
    lower.lastIndexOf("para registrar el mantenimiento necesito la patente"),
    lower.lastIndexOf("para programar mantenimiento preventivo necesito la patente"),
  ].filter((i) => i >= 0);
  if (markers.length === 0) return false;
  const after = normThreadText(threadText.slice(Math.max(...markers) + 60));
  if (!after.trim()) return false;
  return (
    /\b(certificado|cobertura|odometro|horometro)\b/.test(after) ||
    (/\b(gps|ignicion|como puedo saber|marcado bien)\b/.test(after) &&
      !/\bconfirmo\b/.test(after.slice(-80)))
  );
}

/** Hilo reciente donde ya se informó caso/asesor — evita re-derivar por palabras del historial. */
export function looksLikePostAdvisorCaseThread(threadText: string | undefined | null): boolean {
  const tail = String(threadText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .slice(-2800);
  if (!tail.trim()) return false;
  return (
    /ya ten[eé]s el caso/.test(tail) ||
    /gener[eé] el caso n[°º]?\s*\d+/.test(tail) ||
    /caso n[°º]?\s*\d+.{0,120}(revisi[oó]n|asesor)/.test(tail) ||
    /asesor.{0,100}(contact|revis|va a)/.test(tail) ||
    /un asesor de atenci[oó]n al cliente/.test(tail)
  );
}

/** Aceptación breve tipo CONFIRMO / sí / dale / ok. */
export function looksLikeBriefConfirmation(text: string | undefined | null): boolean {
  const t = String(text ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (!t) return false;
  if (t.startsWith("conf")) return true;
  return new Set([
    "si",
    "sii",
    "sip",
    "dale",
    "dalesi",
    "sidale",
    "ok",
    "oka",
    "okey",
    "okay",
    "listo",
    "correcto",
    "deacuerdo",
    "perfecto",
  ]).has(t);
}

export function looksLikeCertificateUnitReply(text: string, threadText = ""): boolean {
  if (detectLoosePlate(text) || isBarePlatePrefixHint(text)) return true;
  if (extractPlateCorrectionHint(text)) return true;
  const norm = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(quiero|necesito|ver|consultar|saber|gps|ignicio|ignicion|reporte|offline|ubicacion)\b/.test(norm)) {
    return false;
  }
  if (certificateFlowState(threadText) !== "awaiting_unit") return false;
  if (/\b(de la|para la|la unidad|unidad)\b/.test(norm) && /[a-z0-9]{2,}/.test(norm)) return true;
  return false;
}

/** Ignora mensajes anteriores al último cambio de empresa o reinicio de conversación. */
export function threadTextSinceCompanySelection(text: string): string {
  const lines = text.split("\n");
  let cut = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /Listo, reinici[eé] la empresa/i.test(line) ||
      /Perfecto, sigo con/i.test(line) ||
      /Est[aá]s operando con/i.test(line) ||
      /asociado a m[aá]s de una empresa/i.test(line) ||
      /arrancamos de nuevo/i.test(line) ||
      /empezamos de nuevo/i.test(line) ||
      /comenzamos de nuevo/i.test(line)
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
  const legacy4 = compact.match(/^([A-Z]{3})(\d{4})$/);
  if (legacy4) return `${legacy4[1]} ${legacy4[2]}`;
  return compact;
}

/**
 * Patente para APIs Wara: usa la matrícula tal como está en flota.
 * El cliente puede escribir con espacios o guiones (LWK-7902); el match es flexible,
 * pero el valor enviado a Wara es el registrado en la unidad.
 */
export function resolveWaraPatenteForApi(
  clientInput: string,
  fleetUnit?: { patente?: string | null; unidad?: string | null } | null,
): string {
  const fromFleet = fleetUnit?.patente?.trim();
  if (fromFleet) return fromFleet;

  const wanted = normalizePlate(clientInput);
  const unitName = fleetUnit?.unidad?.trim();
  if (unitName && wanted) {
    const unitNorm = normalizePlate(unitName);
    if (
      unitNorm &&
      (unitNorm === wanted || unitNorm.includes(wanted) || wanted.includes(unitNorm))
    ) {
      return unitName;
    }
  }

  const client = clientInput.trim();
  if (client) return client;
  return normalizePlate(clientInput) ?? clientInput;
}

export function detectIncidentType(text: string): WaraIncidentType {
  const lower = text.toLowerCase();
  if (/(no reporta|offline|sin señal|no actualiza|última señal|ultima señal|no registra ubicación)/.test(lower)) {
    return "MISSING_REPORT";
  }
  if (
    /(problema|no marca|marcando mal|marca mal|no funciona|incorrecto|desfasado|falla|aver[ií]a)/.test(
      lower,
    ) &&
    /(od[oó]metro|kilometraje|hor[oó]metro)/.test(lower)
  ) {
    return "GENERAL_TECH";
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

