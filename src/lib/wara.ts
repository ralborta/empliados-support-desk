import {
  botLineAnchorsCertificateUnitAsk,
  botLineIsCertificateUnitClarification,
} from "@/lib/certificateFlowMessages";
import {
  looksLikeFechaHoraLecturaMessage,
  stripBotPromptExamples,
  stripBotOdometerBotSpeech,
} from "@/lib/odometroFecha";

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

/** Trámites resueltos por Atilio sin intervención humana — no auto-asignar al asesor online. */
export const BOT_ONLY_INCIDENT_TYPES: ReadonlySet<WaraIncidentType> = new Set([
  "CERTIFICATE_ISSUE",
  "ODOMETER_CHANGE",
]);

/**
 * Incidentes que SÍ requieren asesor humano cuando llegan por inbound (regla acordada
 * post-reunión Emma/Lucas 2026-07): solo derivar si hay falta de reporte, acceso/
 * administración, o el cliente pide humano explícitamente (ver shouldAutoAssignInboundMessage
 * en waraApi.ts). Todo lo demás (saludos, "Otro", guías, trámites bot-only) queda sin
 * asignar — el asesor no lo ve; el admin sí.
 */
export const ADVISOR_ASSIGN_INCIDENT_TYPES: ReadonlySet<WaraIncidentType> = new Set([
  "MISSING_REPORT",
  "ADMIN_DERIVATION",
  "ACCESS_PLATFORM",
]);

export function shouldAutoAssignInboundTicket(incidentType: WaraIncidentType): boolean {
  if (BOT_ONLY_INCIDENT_TYPES.has(incidentType)) return false;
  return ADVISOR_ASSIGN_INCIDENT_TYPES.has(incidentType);
}

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
  "AB006EX",
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
 * ID numérico suelto (ej. 2408437) que NO es patente ni código M300-097.
 * Bug real 2026-08-06: el bot trató "unidad 2408437" como unidad resuelta y pidió km.
 */
export function looksLikeBareNumericUnitId(value: string | null | undefined): boolean {
  const compact = normalizePlate(value);
  if (!compact) return false;
  if (!/^\d{4,}$/.test(compact)) return false;
  // Códigos internos con guión ya se normalizan sin guión (300097); esos tienen 5-6 dígitos
  // pero vienen del patrón M?\d{3}-\d{2,3}. Un ID administrativo suele ser ≥7 dígitos.
  return compact.length >= 7;
}

/**
 * Detecta la primera patente REAL en el texto, ignorando las patentes de ejemplo
 * de los prompts. Si solo hay ejemplos, devuelve null.
 */
const PLATE_STOPWORDS = new Set([
  "DEL",
  "LOS",
  "LAS",
  "UNA",
  "UNO",
  "CON",
  "POR",
  "SUS",
  // Prefijo de interno de flota (INT 145 / INT-145), no patente Mercosur.
  "INT",
]);

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

/**
 * Todas las patentes completas y válidas mencionadas en el texto, en el orden en que
 * aparecen. A diferencia de detectPlate (que devuelve solo la primera), esta función
 * permite distinguir mensajes que mencionan más de una patente en un mismo texto, como
 * las correcciones explícitas ("no es la OST 223, es la AD 427 MC").
 */
export function detectAllPlates(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const match of text.matchAll(PLATE_REGEX_GLOBAL)) {
    const plate = normalizePlate(match[1]);
    if (!plate || EXAMPLE_PLATES.has(plate)) continue;
    const letters = plate.match(/^[A-Z]+/)?.[0] ?? "";
    if (letters.length === 3 && PLATE_STOPWORDS.has(letters)) continue;
    out.push(plate);
  }
  return out;
}

/** Quita artículo inicial antes de parsear patente ("La AD578WX" → "AD578WX"). */
export function stripLeadingPlateArticle(text: string | undefined | null): string {
  return String(text ?? "")
    .trim()
    .replace(/^(la|el|los|las|esa|ese|eso)\s+/i, "");
}

/** Mensaje corto que parece ser solo una patente (ej. "Lwk7902"). */
export function looksLikePlateOnlyMessage(text: string): boolean {
  const raw = stripLeadingPlateArticle(text);
  // Bug real, producción 2026-07-29: "No es 152344" (corrigiendo un valor durante una
  // confirmación pendiente de odómetro) compactaba a "NOES152344" — 4 letras + dígitos,
  // forma indistinguible de una patente vieja mal separada (ej. "NOES 15234" no existe,
  // pero el shape "letras+números" es el mismo). Ninguna patente real trae la palabra
  // "no" como token independiente seguido de un verbo — frases de negación/corrección
  // ("no es", "no era", "no son", "no fue/fueron") nunca son un intento de patente suelta,
  // así que se descartan ANTES de compactar espacios.
  if (/\bno\b,?\s+(?:es|era|son|eran|fue|fueron)\b/i.test(raw)) return false;
  const compact = raw.replace(/[\s\-_.]+/g, "");
  if (!compact || compact.length < 5 || compact.length > 12) return false;
  if (!/^[A-Za-z0-9-]+$/.test(compact)) return false;
  if (!/\d/.test(compact)) return false;
  // Bug real, producción 2026-07-23: "300-092" y "M300-093" (formato de NOMBRE de
  // unidad, como el propio bot sugiere de ejemplo: "M300-111") pasaban esta función
  // porque solo exigía "al menos un dígito" — ninguna patente real (vieja o Mercosur)
  // es puramente numérica o tiene un único carácter de letra. Sin este chequeo se
  // interpretaban como un intento de patente suelta (y fallaban ahí, con mensajes de
  // "prefijo inexistente"), en vez de tratarse como búsqueda por nombre de unidad
  // (que sí puede resolver contra el catálogo real vía filterUnitsByNombre).
  if (!/^[A-Za-z]{2,3}/.test(compact)) return false;
  const norm = normalizePlate(compact);
  // INT145 u otros tokens con stopword / formato no-patente no cuentan como patente suelta.
  if (!norm || isExamplePlate(norm) || !isPlausibleVehiclePlate(norm)) return false;
  return true;
}

/** Prefijo suelto de patente (NKL, HEJ, AG) sin ser patente completa. */
export function looksLikeBareNegativeResponse(rawText: string | undefined | null): boolean {
  const norm = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[!?.¡¿]+/g, "")
    .trim();
  if (!norm || norm.length > 24) return false;
  // "no", "no.", "no no", "nop", "nope" — negación breve, NO prefijo de patente.
  // Bug real, producción 2026-07-30: "no" tras "¿te referís a AE 483 VE?" buscaba
  // unidades que empiezan con "NO".
  if (/^(no|nop|nope|nel|nah)(?:[\s,]+no)?$/.test(norm)) return true;
  return false;
}

/** El bot acaba de pedir confirmar si el cliente se refiere a una patente concreta. */
export function threadBotRecentlyAskedPlateReference(threadText: string): boolean {
  const tail = threadText
    .slice(-2500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /(?:refer[ií]s|referis|confirmar\s+si).*?(?:patente|matricula)/.test(tail) ||
    /(?:patente|matricula|matr[ií]cula).*refer/i.test(tail) ||
    /pod[eé]s\s+confirmar\s+si\s+te\s+refer/i.test(tail)
  );
}

export function buildAmbiguousPlateOrNegationClarificationReply(): string {
  return (
    "Entendido. ¿Querés decir que NO es esa patente, o me estás pasando parte de la matrícula? " +
    "Pasame la patente completa (ej. AE 483 VE) o la marca/nombre de la unidad."
  );
}

export function isBarePlatePrefixHint(text: string | undefined | null): boolean {
  if (looksLikeBriefConfirmation(text)) return false;
  if (looksLikeBareNegativeResponse(text)) return false;
  const stripped = String(text ?? "")
    .trim()
    .replace(/^(la|el|esa|ese)\s+/i, "");
  const compact = stripped.replace(/[\s\-_.]+/g, "").toUpperCase();
  if (NON_PLATE_PREFIX_WORDS.has(compact.toLowerCase())) return false;
  if (!/^[A-Z]{2,3}\d{0,4}$/.test(compact)) return false;
  return !isPlausibleVehiclePlate(compact);
}

/** Pronombres/conectores cortos (2-3 letras, sin dígitos) que jamás son un prefijo de
 * patente real, aunque calcen con la forma "letras cortas sin dígitos" que exige el
 * patrón "la/el/esa/ese + <hint>" de abajo. */
const NON_PLATE_PREFIX_WORDS = new Set([
  "que",
  "los",
  "por",
  "con",
  "una",
  "uno",
  "eso",
  "esa",
  "ese",
  "el",
  "la",
  "las",
  "unos",
  "unas",
  "de",
  "del",
  "al",
  "en",
  "para",
  "a",
  "no",
  "nop",
  "nope",
  "nel",
  "nah",
  // Bug real, producción 2026-07-31: "La veo detenida" → prefijo VEO (verbo "veo", no patente).
  "veo",
]);

// Tolerantes a la letra de más/de menos más común en "empieza"/"comienza"
// (empieza/empiza/empeza, comienza/cominza/comenza), sin abrir tanto el patrón como
// para matchear palabras no relacionadas.
const EMPIEZA_RE = "emp(?:ie|i|e)za(?:n)?";
const COMIENZA_RE = "com(?:ie|i|e)nza(?:n)?";

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
    if (
      !NON_PLATE_PREFIX_WORDS.has(compact.toLowerCase()) &&
      !isPlausibleVehiclePlate(compact) &&
      /^[A-Z]{2,3}\d{0,4}$/.test(compact)
    ) {
      return compact;
    }
  }

  if (isBarePlatePrefixHint(rawText)) {
    return String(rawText ?? "")
      .trim()
      .replace(/^(la|el|esa|ese)\s+/i, "")
      .replace(/[\s\-_.]+/g, "")
      .toUpperCase();
  }

  // Bug real, producción 2026-07-28: "cambiar el odometro de la q comienza OST" (sin la
  // palabra "con") no matcheaba este patrón porque exigía "empieza/comienza CON X" a
  // rajatabla. Al no detectarse el prefijo acá, el caller (odometro-horometro/route.ts)
  // asumía que no había prefijo en el mensaje y dejaba pasar sin validar contra la flota
  // lo que la IA/regex hubiera extraído como "patente" — terminando en "Perfecto, tomo
  // OST" (un prefijo con VARIAS unidades reales: OST 223, OST 224, OST 225, OST 226...)
  // en vez de listar las coincidencias y pedir cuál. Ahora "con" es opcional.
  //
  // Bug real, producción 2026-07-28 (mismo día, segunda vuelta): "quiero el estado de
  // la unidad q empiza con OST" (typo "empiza" en vez de "empieza") tampoco matcheaba
  // ninguna de las 4 alternativas literales — al no detectarse el prefijo, la consulta
  // de estado se iba directo a la IA SIN el catálogo filtrado por prefijo (ni la ruta
  // de reglas que arma el listado "Encontré N unidades que empiezan con X..."), y el
  // cliente recibía un genérico "Encontré varias unidades posibles" sin ver las
  // patentes reales — peor que antes. EMPIEZA_RE/COMIENZA_RE toleran letras de más o de
  // menos en el medio de la palabra (empieza/empiza/empeza, comienza/cominza/comenza).
  const laQue = norm.match(
    new RegExp(
      `\\b(?:la|el|esa|ese)\\s+(?:q|que)\\s+(?:${EMPIEZA_RE}|${COMIENZA_RE})\\s+(?:con\\s+)?([a-z0-9]{2,6})\\b`,
    ),
  );
  if (laQue?.[1] && !NON_PLATE_PREFIX_WORDS.has(laQue[1].toLowerCase())) {
    return laQue[1].replace(/\s+/g, "").toUpperCase();
  }

  const explicit = norm.match(
    new RegExp(`(?:${EMPIEZA_RE}|${COMIENZA_RE})\\s+(?:con\\s+)?([a-z0-9]{2,6})\\b`, "i"),
  );
  if (explicit?.[1] && !NON_PLATE_PREFIX_WORDS.has(explicit[1].toLowerCase())) {
    return explicit[1].replace(/\s+/g, "").toUpperCase();
  }

  // "La veo detenida" / "no está reportando" — descripción operativa, no prefijo de patente.
  if (
    /\b(la|lo)\s+veo\b/.test(norm) ||
    /\b(no\s+)?(?:esta\s+)?reportando\b/.test(norm) ||
    (/\b(detenida|detenido|parada|parado)\b/.test(norm) &&
      /\b(reporta|reportando|gps|ignicion|senal)\b/.test(norm))
  ) {
    return null;
  }

  const laPrefix = norm.match(/\b(?:la|el|esa|ese)\s+([a-z]{2,3}\d{0,3})\b/);
  if (laPrefix?.[1]) {
    const hint = laPrefix[1].replace(/\s+/g, "").toUpperCase();
    // Bug real, producción 2026-07-23: "Es la unidad por la QUE te consulté por
    // reporte" hacía matchear "la" + "que" (3 letras, sin dígitos) como si "QUE"
    // fuera un prefijo de patente real ("la AB" → prefijo "AB") — el bot respondía
    // "no hay ninguna unidad con patente que empiece con QUE" en vez de reconocer que
    // el cliente estaba haciendo una referencia vaga a la unidad ya mencionada.
    // "que"/pronombres relativos comunes nunca son un prefijo de flota real.
    if (!NON_PLATE_PREFIX_WORDS.has(hint.toLowerCase()) && !isPlausibleVehiclePlate(hint)) return hint;
  }

  const paraPatente = norm.match(/\bpatente\b(?:\s+(?:con|de|del))?\s+([a-z0-9]{2,6})\b/i);
  if (paraPatente?.[1]) {
    const hint = paraPatente[1].replace(/\s+/g, "").toUpperCase();
    if (!NON_PLATE_PREFIX_WORDS.has(hint.toLowerCase())) return hint;
  }

  // Typo / LN general: verbo ≈ comienza/empieza (aunque mal escrito) + prefijo 2-3 letras.
  // Bug real 2026-08-06: "coiemza ad", "cvomienza con ad" no matcheaban el regex acotado
  // y el bot preguntaba si el texto crudo era la patente en vez de buscar prefijo AD.
  const fuzzyPrefix = extractPlatePrefixAfterFuzzyStartsVerb(norm);
  if (fuzzyPrefix) return fuzzyPrefix;

  return null;
}

const STARTS_WITH_VERBS = [
  "comienza",
  "comienzan",
  "empieza",
  "empiezan",
  "arranca",
  "arrancan",
  "inicia",
  "inician",
] as const;

/** Token que parece "comienza/empieza/…" aunque esté mal tipeado. */
function tokenLooksLikeStartsWithVerb(token: string): boolean {
  const t = token.replace(/[^a-z]/g, "");
  if (t.length < 5 || t.length > 12) return false;
  for (const verb of STARTS_WITH_VERBS) {
    const maxDist = verb.length <= 6 ? 2 : 3;
    if (levenshteinDistance(t, verb) <= maxDist) return true;
  }
  // Forma blanda: com…za / emp…za / co…ienza (cubre coiemza, cvomienza, etc.)
  if (/^c[ov]?o?m?\w{0,4}n?za$/.test(t) && t.includes("z")) return true;
  if (/^emp\w{0,4}za$/.test(t)) return true;
  return false;
}

/**
 * Prefijo tras verbo fuzzy de "empieza/comienza" (con o sin "con").
 * General: no lista de frases; cualquier typo cercano + letras de patente.
 */
function extractPlatePrefixAfterFuzzyStartsVerb(norm: string): string | null {
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokenLooksLikeStartsWithVerb(tokens[i]!)) continue;
    let j = i + 1;
    // "con" / typos frecuentes ("cn", "c") — conector, no prefijo.
    while (j < tokens.length && /^(?:con|cn|c)$/.test(tokens[j]!)) j++;
    const cand = tokens[j];
    if (!cand) continue;
    if (!/^[a-z]{2,3}\d{0,3}$/.test(cand)) continue;
    if (NON_PLATE_PREFIX_WORDS.has(cand)) continue;
    const hint = cand.toUpperCase();
    if (isPlausibleVehiclePlate(hint)) continue;
    return hint;
  }
  return null;
}

/** Sufijo de patente en frases como "la que termina con TL", "termina en GD". */
export function extractPlateSuffixFromMessage(rawText: string | undefined | null): string | null {
  const norm = String(rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return null;

  const laQue = norm.match(
    /\b(?:la|el|esa|ese)\s+(?:q|que)\s+(?:termina|finaliza|acaba)\s+(?:con|en)\s+([a-z0-9]{2,6})\b/,
  );
  if (laQue?.[1] && !NON_PLATE_PREFIX_WORDS.has(laQue[1].toLowerCase())) {
    return laQue[1].replace(/\s+/g, "").toUpperCase();
  }

  const explicit = norm.match(/\b(?:termina|finaliza|acaba)\s+(?:con|en)\s+([a-z0-9]{2,6})\b/);
  if (explicit?.[1] && !NON_PLATE_PREFIX_WORDS.has(explicit[1].toLowerCase())) {
    return explicit[1].replace(/\s+/g, "").toUpperCase();
  }

  return null;
}

/** Patente en el mensaje actual, incluyendo formatos viejos (LWK7902) y respuestas sueltas. */
export function detectLoosePlate(text: string): string | null {
  const stripped = stripLeadingPlateArticle(text);
  const fromRegex = detectPlate(stripped) ?? detectPlate(text);
  if (fromRegex) return fromRegex;
  if (looksLikePlateOnlyMessage(stripped)) {
    return normalizePlate(stripped.replace(/[\s\-_.]+/g, ""));
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
  if (looksLikeFechaHoraLecturaMessage(raw)) return null;
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
    /\b(?:patente|matricula)\b\s+(?:con|de|del)\s+([a-z0-9]{2,9})\b/i,
    /\b(?:de la|para la)\b\s+([a-z0-9]{2,12})\b/i,
    /\bno\b.{0,12}\bpara\b.{0,12}\bla\b\s+([a-z0-9]{2,12})\b/i,
    /\bno\b.{0,16}\bla\b\s+([a-z0-9]{2,12})\b/i,
    /\bno\b.{0,12}\bpara\b.{0,20}\bpatente\b\s+([a-z0-9]{2,9})\b/i,
    /\b(?:patente|matricula)\b\s+(?!de\b|del\b|con\b|por\b)([a-z0-9]{2,9})\b/i,
    /\bla\b\s+([a-z]{2,3}\d{3,4}[a-z]{0,2})\b/i,
  ];
  for (const re of patterns) {
    const m = norm.match(re);
    if (m?.[1]) {
      const hint = m[1].replace(/\s+/g, "").toUpperCase();
      if (hint.length >= 2 && isLikelyPlateOrPrefixToken(hint)) return hint;
      // Bug real, producción 2026-07-23: "dame el certificado de la unidad mencionada"
      // matcheaba el patrón "de la <palabra>" y devolvía "UNIDAD" como si fuera un
      // dato útil (patente/marca), pisando la resolución por contexto (la unidad ya
      // confirmada en el hilo). Es imposible enumerar cada palabra genérica de
      // vehículo/referencia que puede aparecer ahí (mismo patrón de listas cerradas
      // de hoy) — se excluye cualquier término del propio vocabulario de "flota"
      // (unidad, patente, vehículo, mismo/a, anterior, mencionado/a, etc.), dejando
      // pasar nombres de marca reales ("Saveiro", "Nissan") que sí ayudan a resolver.
      if (
        hint.length >= 3 &&
        !/^(CORRECTA|OTRA|OTRO|ESA|ESE|LA|EL|MIS|UNA|ESA|ESO|UNIDAD|UNIDADES|VEHICULO|VEHICULOS|PATENTE|PATENTES|MATRICULA|MATRICULAS|CAMION|CAMIONES|AUTO|AUTOS|COCHE|MOTO|FLOTA|MENCIONADA|MENCIONADO|ANTERIOR|MISMA|MISMO|DICHA|DICHO|REFERIDA|REFERIDO|CUESTION|ULTIMA|ULTIMO|ULTIMAS|ULTIMOS|UBICACION|COORDENADAS|COORDENADA|POSICION|REPORTE|ESTADO|GPS|CONSULTA|TARDE|MANANA|NOCHE|MADRUGADA|MEDIODIA|MEDIANOCHE|HOY|AYER|ANOCHE|ANTEAYER)$/.test(
          hint,
        )
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

/** Trámite de odómetro/horómetro ya registrado con éxito sin un trámite nuevo posterior. */
export function threadOdometerRegistrationCompleted(threadText: string): boolean {
  const lower = threadText.toLowerCase();
  const successIdx = Math.max(
    lower.lastIndexOf("listo, registr"),
    lower.lastIndexOf("registré el cambio para la unidad"),
    lower.lastIndexOf("registre el cambio para la unidad"),
  );
  if (successIdx < 0) return false;
  const afterSuccess = threadText.slice(successIdx).toLowerCase();
  if (
    /\b(cambiar|cambio de|actualizar|registrar|ajust\w*|hagamos|quiero|necesito)\b.{0,100}\b(od[oó]metro|hor[oó]metro)\b/.test(
      afterSuccess,
    ) ||
    /\b(od[oó]metro|hor[oó]metro)\b.{0,100}\b(cambiar|actualizar|ajust\w*)\b/.test(afterSuccess) ||
    /para registrar el cambio de hor[oó]metro necesito la patente/.test(afterSuccess) ||
    /para registrar el cambio de od[oó]metro necesito la patente/.test(afterSuccess) ||
    /perfecto, tomo .+ cu[aá]l es el nuevo hor[oó]metro/.test(afterSuccess)
  ) {
    return false;
  }
  return true;
}

function normalizedOdometerTail(threadText: string): string {
  return threadText
    .slice(-2500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Confirmación parafraseada por el agente IA (sin plantilla "Voy a registrar:"). */
export function threadHasAgentStyleOdometerConfirmPending(threadText: string): boolean {
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  const tail = normalizedOdometerTail(threadText);
  return (
    (/\bconfirm[aá]s?\s+que\s+estos\s+datos\b/.test(tail) ||
      /\bdatos\s+son\s+correctos\s+para\s+proceder\b/.test(tail)) &&
    /\b(od[oó]metro|hor[oó]metro)\b/.test(tail) &&
    /\d{4,}/.test(tail)
  );
}

/** Resumen de odómetro pendiente de confirmación (ChatPDF o backend). */
export function hasPendingOdometerConfirmation(threadText: string): boolean {
  const tail = threadText.slice(-2500).toLowerCase();
  if (/listo,\s*registr[eé]|registr[eé] el cambio/.test(tail)) return false;
  // Recordatorio de pausa (consulta lateral): el CONFIRMO sigue vivo aunque el bot
  // haya listado capacidades después (bug 2026-08-10: CONFIRMO en silencio).
  if (threadHasOdometerConfirmStillPendingCue(threadText)) return true;
  if (isOdometerFlowSuperseded(threadText)) return false;
  if (threadHasAgentStyleOdometerConfirmPending(threadText)) return true;
  // Bug real, producción 2026-07-28: tras confirmar patente incorrecta ("Voy a
  // registrar: Patente LWK 7902...respondé CONFIRMO"), el cliente corrigió la unidad
  // ("no para la unidad HEJ") y el bot volvió a preguntar el valor ("Perfecto, tomo
  // HEJ. ¿Cuál es el nuevo odómetro en km?"). El "Voy a registrar" VIEJO seguía
  // dentro de la ventana de 2500 caracteres, así que este chequeo (presencia simple
  // de las 3 frases en cualquier parte del tail) seguía devolviendo "true" pese a que
  // el trámite ya había sido reabierto pidiendo un valor NUEVO — el número que el
  // cliente acababa de dar (ej. "123551") quedaba atrapado por el recordatorio de
  // CONFIRMO de la confirmación vieja en lugar de generarse el resumen nuevo.
  // Ahora se ancla al ÚLTIMO bloque "voy a registrar:" y se verifica que no haya
  // sido reabierto después por un nuevo "perfecto, tomo" / "cuál es el nuevo
  // odómetro/horómetro" / "necesito la patente".
  const lastConfirmIdx = Math.max(
    tail.lastIndexOf("voy a registrar:"),
    tail.lastIndexOf("voy a registrar los siguientes datos"),
  );
  if (lastConfirmIdx < 0) return false;
  const afterLastConfirm = tail.slice(lastConfirmIdx);
  const reopenedAfterConfirm =
    /perfecto, tomo /.test(afterLastConfirm.slice(16)) ||
    /cu[aá]l es el nuevo (od[oó]metro|hor[oó]metro)/.test(afterLastConfirm.slice(16)) ||
    /necesito la patente/.test(afterLastConfirm.slice(16));
  if (reopenedAfterConfirm) return false;
  return (
    /od[oó]metro|hor[oó]metro/.test(afterLastConfirm) &&
    (/respond[eé]\s+confirmo/.test(afterLastConfirm) || /\bconfirmo\b/.test(afterLastConfirm))
  );
}

/**
 * El bot recordó explícitamente que el CONFIRMO de odómetro/horómetro sigue pendiente
 * (p.ej. tras una consulta lateral). Ese cue manda sobre listados de capacidades.
 */
export function threadHasOdometerConfirmStillPendingCue(threadText: string): boolean {
  const tail = threadText.slice(-2800).toLowerCase();
  if (/listo,\s*registr[eé]|registr[eé] el cambio/.test(tail)) return false;
  return (
    /sigue pendiente/.test(tail) &&
    /\bconfirmo\b/.test(tail) &&
    /\b(od[oó]metro|hor[oó]metro)\b/.test(tail)
  );
}

/** Quita menús de capacidades del bot para no confundirlos con cambio de tema del cliente. */
function stripBotCapabilityNoiseFromThread(afterLower: string): string {
  return afterLower
    .replace(
      /s[ií],?\s*puedo ayudarte[\s\S]{0,700}?(hablar con un asesor|hablar con una persona)\.?/gi,
      " ",
    )
    .replace(
      /el cambio de od[oó]metro\/hor[oó]metro sigue pendiente[\s\S]{0,280}?qu[eé] corregir\.?/gi,
      " ",
    );
}

/**
 * El cliente siguió con otra cosa (guía Opciones/Unidades, etc.) después de un odómetro a medias.
 * El hilo conserva contexto pero el trámite queda abandonado.
 */
function lastClientLineBeforeDeNada(tail: string): string {
  const idx = tail.toLowerCase().lastIndexOf("de nada");
  if (idx < 0) return "";
  const before = tail.slice(0, idx);
  const lines = before.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^atilio:/i.test(lines[i])) continue;
    return lines[i].replace(/^cliente:\s*/i, "").trim();
  }
  return "";
}

function deNadaAbandonsOdometerFlow(threadText: string, cutIdx: number): boolean {
  const tail = threadText.slice(cutIdx);
  const lower = tail.toLowerCase();
  if (!/\bde nada\b/.test(lower)) return false;
  const lastConfirmIdx = Math.max(
    lower.lastIndexOf("voy a registrar:"),
    lower.lastIndexOf("voy a registrar los siguientes datos"),
  );
  if (lastConfirmIdx < 0) return true;
  const afterConfirm = lower.slice(lastConfirmIdx);
  if (/listo,\s*registr[eé]|registr[eé] el cambio/.test(afterConfirm)) return true;
  const reopenedAfterConfirm =
    /perfecto, tomo /.test(afterConfirm.slice(16)) ||
    /cu[aá]l es el nuevo (od[oó]metro|hor[oó]metro)/.test(afterConfirm.slice(16)) ||
    /necesito la patente/.test(afterConfirm.slice(16));
  if (reopenedAfterConfirm) return true;
  // Bug real, producción 2026-07-31: tras "Gracias" sin confirmar, el bot respondía
  // "De nada, ¿Necesitás algo más?" y `\bde nada\b` marcaba el trámite como abandonado —
  // "confirmo" y reenvío de km/fecha quedaban en silencio.
  if (/respond[eé]\s+confirmo/.test(afterConfirm) || /\bconfirmo para registrarlo\b/.test(afterConfirm)) {
    const lastClient = lastClientLineBeforeDeNada(tail)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (/\b(gracias|agradezco|muchas gracias)\b/.test(lastClient)) return false;
    if (/^(ok|si|s[ií]|dale|listo|perfecto|genial|bueno)[\s!.]*$/.test(lastClient)) return true;
    return false;
  }
  return true;
}

export function isOdometerFlowSuperseded(threadText: string): boolean {
  if (!threadText.trim()) return false;
  // Bug 2026-08-10: tras pausa por "otra consulta", el bot listó capacidades
  // (certificado/odómetro/…) y este detector marcaba el trámite abandonado →
  // CONFIRMO caía en skip silencioso. Si el bot recordó el pending, no abandonar.
  if (threadHasOdometerConfirmStillPendingCue(threadText)) return false;
  const lower = threadText.toLowerCase();
  const markers = [
    lower.lastIndexOf("voy a registrar:"),
    lower.lastIndexOf("para registrar el cambio de horómetro"),
    lower.lastIndexOf("para registrar el cambio de horometro"),
    lower.lastIndexOf("para registrar el cambio de odómetro"),
    lower.lastIndexOf("para registrar el cambio de odometro"),
    lower.lastIndexOf("cuál es el nuevo odómetro"),
    lower.lastIndexOf("cual es el nuevo odometro"),
    lower.lastIndexOf("cuál es el nuevo horómetro"),
    lower.lastIndexOf("cual es el nuevo horometro"),
    lower.lastIndexOf("nuevo odómetro en km"),
    lower.lastIndexOf("nuevo odometro en km"),
    lower.lastIndexOf("pasame el nuevo odómetro en km"),
    lower.lastIndexOf("pasame el nuevo odometro en km"),
    lower.lastIndexOf("pasame el valor del odómetro"),
    lower.lastIndexOf("pasame el valor del odometro"),
    lower.lastIndexOf("pasame el nuevo horómetro en horas"),
    lower.lastIndexOf("pasame el nuevo horometro en horas"),
    lower.lastIndexOf("perfecto, tomo "),
    lower.lastIndexOf("necesito la fecha y hora"),
    lower.lastIndexOf("fecha y hora de la lectura"),
    lower.lastIndexOf("si fue recién, respondé"),
    lower.lastIndexOf("si fue recien, responde"),
  ].filter((i) => i >= 0);
  if (markers.length === 0) return false;
  const cutIdx = Math.max(...markers);
  const afterMarkerBlock = threadText.slice(cutIdx);
  // Trámite ya registrado con éxito: no bloquear nuevas consultas de odómetro por temas posteriores.
  if (/listo,\s*registr[eé]|registr[eé] el cambio para la unidad/i.test(afterMarkerBlock)) {
    return false;
  }
  const stillPickingUnitForOdo = isStillPickingUnitForOdoBlock(afterMarkerBlock);
  // Solo mensajes del cliente cuentan como cambio de tema — no el menú de capacidades del bot.
  const after = stripBotCapabilityNoiseFromThread(threadText.slice(cutIdx + 80).toLowerCase());
  if (!after.trim()) return false;
  // Pedir listado de flota para elegir la unidad durante un trámite de odómetro NO es
  // cambio de tema (bug producción 2026-07-29: "Pásame el listado?" → bot "Tenés 414
  // unidades" marcaba el trámite como abandonado y "Ah es la RMX" caía a GPS/estado).
  const fleetListToPickUnit = /\b(listado|p[aá]same (el )?listado|p[aá]same la lista|lista de (mis )?unidades)\b/.test(
    after,
  );
  if (stillPickingUnitForOdo) {
    return (
      /(modulo opciones|entra a opciones|ingresa a opciones|agenda de contactos|agregar contacto|sum[aá]s un nuevo contacto|mis atajos|modulo unidades|modulo de unidades)/.test(
        after,
      ) ||
      /\b(certificado|cobertura|monitoreo|constancia)\b/.test(after) ||
      (/patente de la unidad/.test(after) && /preventivo o correctivo/.test(after)) ||
      /\bmantenimiento (preventivo|correctivo)\b/.test(after) ||
      (/\b(consultar|quiero consultar).{0,80}\b(reporte|unidades|gps|ignicion)\b/.test(after) &&
        !fleetListToPickUnit) ||
      /\b(no reporta|no me reporta|sin reporte|estado de reporte|reporte de mis unidades)\b/.test(
        after,
      ) ||
      deNadaAbandonsOdometerFlow(threadText, cutIdx) ||
      (/1\.\s*(entra|ingresa|abri)/.test(after) &&
        /(agenda|opciones|contacto|unidades|grupo)/.test(after))
    );
  }
  return (
    /(modulo opciones|entra a opciones|ingresa a opciones|agenda de contactos|agregar contacto|sum[aá]s un nuevo contacto|mis atajos|modulo unidades|modulo de unidades)/.test(
      after,
    ) ||
    /\b(certificado|cobertura|monitoreo|constancia)\b/.test(after) ||
    /\b(no reporta|no me reporta|sin reporte|estado de reporte|reporte de mis unidades|listado de mis unidades)\b/.test(
      after,
    ) ||
    // Bug real, producción 2026-07-28: tras un pedido de mantenimiento ("Puedo ayudarte
    // con mantenimiento por acá: decime la patente de la unidad y si es preventivo o
    // correctivo..."), el trámite de horómetro seguía "activo" de fondo — un mensaje
    // ambiguo posterior ("la misma patente") volvía a caer en el recordatorio de
    // horómetro en vez de seguir el mantenimiento, aunque el propio bot ya había
    // pivotado de tema. Mismo patrón de detección que hasPendingMaintenancePlateRequest.
    (/patente de la unidad/.test(after) && /preventivo o correctivo/.test(after)) ||
    /\bmantenimiento (preventivo|correctivo)\b/.test(after) ||
    /\b(consultar|quiero consultar).{0,80}\b(reporte|unidades|gps|ignicion)\b/.test(after) ||
    (/\bunidades registradas\b/.test(after) && !fleetListToPickUnit) ||
    (/ten[eé]s\s+\d+\s+unidades/.test(after) && !fleetListToPickUnit) ||
    // Bug real, producción 2026-07-23: tras "Voy a registrar: ...", el propio bot
    // reaccionó a un mensaje del cliente sin patente re-preguntando "Para registrar
    // el cambio de odómetro NECESITO la patente de la unidad..." — esa respuesta del
    // BOT (todavía dentro del MISMO trámite de odómetro) quedaba en el hilo y hacía
    // matchear este "necesito/quiero" genérico, marcando el trámite como abandonado
    // cuando en realidad seguía activo. Si "necesito/quiero/pedir/solicitar" aparece
    // junto con contexto de odómetro/patente, es el propio trámite continuando, no un
    // pedido distinto.
    //
    // Bug real 2026-08-06: "necesito la fecha y hora de la lectura" / "Tomé … (10500 km)"
    // también disparaba este false positive → el cliente mandaba "Hora: 14:14 fecha …"
    // y el turno caía a unidades (typing eterno / sin respuesta).
    (/\b(necesito|quiero|pedir|solicitar)\b/.test(after) &&
      !/\b(od[oó]metro|hor[oó]metro|kilometraje|\bkm\b|patente|matr[ií]cula|fecha|hora|lectura)\b/.test(
        after,
      )) ||
    deNadaAbandonsOdometerFlow(threadText, cutIdx) ||
    (/1\.\s*(entra|ingresa|abri)/.test(after) &&
      /(agenda|opciones|contacto|unidades|grupo)/.test(after))
  );
}

function lastOdometerFlowMarkerIndex(threadText: string): number {
  const lower = threadText.toLowerCase();
  const markers = [
    lower.lastIndexOf("voy a registrar:"),
    lower.lastIndexOf("para registrar el cambio de horómetro"),
    lower.lastIndexOf("para registrar el cambio de horometro"),
    lower.lastIndexOf("para registrar el cambio de odómetro"),
    lower.lastIndexOf("para registrar el cambio de odometro"),
    lower.lastIndexOf("cuál es el nuevo odómetro"),
    lower.lastIndexOf("cual es el nuevo odometro"),
    lower.lastIndexOf("cuál es el nuevo horómetro"),
    lower.lastIndexOf("cual es el nuevo horometro"),
    lower.lastIndexOf("nuevo odómetro en km"),
    lower.lastIndexOf("nuevo odometro en km"),
    lower.lastIndexOf("pasame el nuevo odómetro en km"),
    lower.lastIndexOf("pasame el nuevo odometro en km"),
    lower.lastIndexOf("pasame el valor del odómetro"),
    lower.lastIndexOf("pasame el valor del odometro"),
    lower.lastIndexOf("pasame el nuevo horómetro en horas"),
    lower.lastIndexOf("pasame el nuevo horometro en horas"),
    lower.lastIndexOf("perfecto, tomo "),
    lower.lastIndexOf("necesito la fecha y hora"),
    lower.lastIndexOf("fecha y hora de la lectura"),
    lower.lastIndexOf("si fue recién, respondé"),
    lower.lastIndexOf("si fue recien, responde"),
  ].filter((i) => i >= 0);
  return markers.length ? Math.max(...markers) : -1;
}

/** Bloque del hilo desde el marcador de odómetro: todavía eligiendo unidad (sin pedir km todavía). */
function isStillPickingUnitForOdoBlock(block: string): boolean {
  const blockLower = block.toLowerCase();
  return (
    (/para registrar el cambio de od[oó]metro necesito la patente/.test(blockLower) ||
      /para registrar el cambio de hor[oó]metro necesito la patente/.test(blockLower)) &&
    !/cu[aá]l es el nuevo od[oó]metro/.test(blockLower) &&
    !/cu[aá]l es el nuevo hor[oó]metro/.test(blockLower) &&
    !/pasame el nuevo od[oó]metro/.test(blockLower) &&
    !/pasame el nuevo hor[oó]metro/.test(blockLower)
  );
}

/** Trámite de odómetro pausado por búsqueda/GPS/consulta de unidad DESPUÉS del último marcador. */
function odometerFlowPausedByLaterTramite(threadText: string): boolean {
  const markerIdx = lastOdometerFlowMarkerIndex(threadText);
  if (markerIdx < 0) return false;
  const after = threadText.slice(markerIdx);
  const stillPickingUnit = isStillPickingUnitForOdoBlock(after);
  if (/\bayudame a encontrar mi unidad\b/i.test(after)) return true;
  if (/\bno encuentro\b.{0,40}\b(unidad|patente|matricula|matr[ií]cula)\b/i.test(after)) return true;
  const lower = threadText.toLowerCase();
  const unitConsultMarkers = [
    lower.lastIndexOf("para revisar el gps"),
    lower.lastIndexOf("cuál es la matrícula o el nombre"),
    lower.lastIndexOf("cual es la matricula o el nombre"),
    lower.lastIndexOf("indicame la matricula"),
    lower.lastIndexOf("indicáme la matrícula"),
    lower.lastIndexOf("matrícula exacta"),
    lower.lastIndexOf("matricula exacta"),
    lower.lastIndexOf("decime la matrícula exacta"),
    lower.lastIndexOf("decime la matricula exacta"),
  ].filter((i) => i >= 0);
  if (unitConsultMarkers.length && Math.max(...unitConsultMarkers) > markerIdx) return true;
  const afterTail = after.slice(80).toLowerCase();
  const fleetListToPickUnit = /\b(listado|p[aá]same (el )?listado|p[aá]same la lista|lista de (mis )?unidades)\b/.test(
    afterTail,
  );
  if (
    /\b(consultar|quiero consultar).{0,80}\b(reporte|unidades|gps|ignicion)\b/.test(afterTail) &&
    !(stillPickingUnit && fleetListToPickUnit)
  ) {
    return true;
  }
  if (
    /\b(no reporta|no me reporta|sin reporte|estado de reporte|listado de mis unidades)\b/.test(
      afterTail,
    ) &&
    !(stillPickingUnit || fleetListToPickUnit)
  ) {
    return true;
  }
  return false;
}

/** Cliente consultó estado/reporte/GPS en las últimas líneas — pausa trámite de odómetro arrastrado. */
export function threadHasRecentUnitStatusConsultIntent(threadText: string): boolean {
  const tail = threadText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-12);
  return tail.some((line) => {
    if (/^atilio:/i.test(line)) return false;
    const t = line
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (
      /\b(no reporta|no me reporta|sin reporte|falta de reporte|offline|sin señal|sin senal)\b/.test(t) ||
      /\b(no\s+)?(?:esta\s+)?reportando\b/.test(t)
    ) {
      return true;
    }
    return (
      /\b(consultar|quiero|necesito|ver|estado|brindas|listado)\b/.test(t) &&
      /\b(reporte|unidades|gps|ignicion|flota)\b/.test(t)
    );
  });
}

/** El bot ofreció revisar/consultar el estado de una unidad y espera sí/no. */
export function threadHasPendingUnitStatusCheckOffer(threadText: string): boolean {
  const tail = threadText
    .slice(-2500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(quer[eé]s|quieres|te gustar[ií]a|podemos|prefer[ií]s|deseas)\b.{0,60}\b(revisar|revis[eé]|consultar|ver|chequear|mirar)\b.{0,50}\b(estado|reporte|gps|ignici[oó]n|unidad)\b/.test(
      tail,
    ) ||
    /\b(revisar|revis[eé]|consultar|ver|chequear)\b.{0,40}\b(el estado de esa unidad|el estado de la unidad|esa unidad|la unidad|estado)\b/.test(
      tail,
    )
  );
}

/** Patente que el bot acaba de confirmar al ofrecer revisar estado (ej. 'AD 578 WX'). */
export function extractPlateFromUnitStatusCheckOffer(threadText: string): string | null {
  const tail = threadText.slice(-2500);
  const quoted = tail.match(
    /['"']([A-Za-z]{2}\s?\d{3}\s?[A-Za-z]{2}|[A-Za-z]{3}\s?\d{3,4})['"']/,
  );
  if (quoted?.[1]) {
    const plate = normalizePlate(quoted[1]);
    if (plate && isPlausibleVehiclePlate(plate)) return plate;
  }
  const plates = detectAllPlates(tail);
  for (let i = plates.length - 1; i >= 0; i--) {
    if (isPlausibleVehiclePlate(plates[i])) return plates[i];
  }
  return detectPlate(tail);
}

/** Bot pidió confirmar km/horómetro y/o fecha antes del resumen formal "Voy a registrar". */
export function threadAwaitingOdometerConfirmDetails(threadText: string): boolean {
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  const tail = threadText
    .slice(-2500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    threadHasAgentStyleOdometerConfirmPending(threadText) ||
    /\b(confirm[aá]r|confirmes|confirmame|confirmar)\b.{0,100}\b(od[oó]metro|kilometraje|valor)\b/.test(
      tail,
    ) ||
    /\b(nuevo valor del od[oó]metro es|el od[oó]metro es|el nuevo valor es|nuevo valor es)\b.{0,50}\d/.test(
      tail,
    ) ||
    /\b(fecha y hora de la lectura|ten[eé]s una fecha y hora)\b/.test(tail) ||
    /\b(fecha y hora (?:de (?:la )?lectura|del cambio)|pasame la fecha y hora|necesito la fecha y hora)\b/.test(
      tail,
    ) ||
    /\bsi fue reci[eé]n,?\s*respond[eé]\s*[«"']?ahora/.test(tail) ||
    /\basumimos que es hoy\b/.test(tail) ||
    /\bpara registrar el cambio de od[oó]metro\b.{0,220}\bconfirm[aá]s?\b/.test(tail)
  );
}

/** Cliente pidió cambio de odómetro/horómetro en mensajes recientes del hilo. */
export function threadHasRecentCustomerMeterUpdateIntent(threadText: string): boolean {
  const lines = threadText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-24);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^(atilio|bot|wara)\s*:/i.test(line)) continue;
    // Líneas del bot sin prefijo (tests / transcripts compactos).
    if (
      /^(perfecto, tomo |para registrar el cambio|voy a registrar:|ten[eé]s \d+ unidades|indic[aá]me la matr[ií]cula|por favor, indic[aá]me|ayudame a encontrar mi unidad|encontr[eé] varias unidades)/i.test(
        line,
      )
    ) {
      continue;
    }
    const msg = line.replace(/^cliente:\s*/i, "").trim();
    if (!msg) continue;
    if (looksLikeExplicitOdometerUpdateRequest(msg) || looksLikeHorometerOnlyIntent(msg)) {
      return true;
    }
    const norm = msg
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (
      /\b(cambiar|actualizar|registrar|informar|modificar)\b/.test(norm) &&
      /\b(od[oó]metro|hor[oó]metro|kilometraje)\b/.test(norm)
    ) {
      return true;
    }
  }
  return false;
}

/** Tras pedir horómetro/odómetro, el bot pidió aclarar la unidad (varias coincidencias). */
export function threadHasOdometerUnitClarificationPending(threadText: string): boolean {
  if (isOdometerFlowSuperseded(threadText)) return false;
  const tail = threadText.slice(-3500).toLowerCase();
  const unitPickCue =
    /encontr[eé] varias unidades|patente exacta|matricula exacta|matr[ií]cula exacta|confirm[aá].{0,30}matr[ií]cula|empiezan con|no encontr[eé] ninguna unidad|decime la patente completa|cu[aá]l quer[eé]s|pasame la patente exacta/i.test(
      tail,
    );
  if (!unitPickCue) return false;
  return (
    /\b(od[oó]metro|hor[oó]metro|kilometraje)\b/.test(tail) ||
    /nuevo od[oó]metro|nuevo hor[oó]metro|registrar el cambio|voy a registrar|perfecto, tomo .+ cu[aá]l es el nuevo/i.test(
      tail,
    ) ||
    /para registrar el cambio de od[oó]metro|para registrar el cambio de hor[oó]metro/i.test(tail)
  );
}

/** Trámite de odómetro activo en el hilo (pide patente/km o confirmación pendiente). */
export function threadHasActiveOdometerFlow(threadText: string): boolean {
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  return (
    threadAwaitingOdometerPlate(threadText) ||
    threadAwaitingHorometerPlate(threadText) ||
    threadAwaitingOdometerKmValue(threadText) ||
    threadAwaitingHorometerKmValue(threadText) ||
    threadAwaitingOdometerConfirmDetails(threadText) ||
    threadHasOdometerUnitClarificationPending(threadText) ||
    hasPendingOdometerConfirmation(threadText)
  );
}

function threadTailSinceFleetUnitSearch(text: string): string {
  const tail = text.slice(-2200);
  const norm = tail
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let cutAt = -1;
  const idxAyuda = norm.lastIndexOf("ayudame a encontrar mi unidad");
  if (idxAyuda >= 0) cutAt = Math.max(cutAt, idxAyuda + "ayudame a encontrar mi unidad".length);
  for (const match of norm.matchAll(/\b(encontrar|buscar)\b.{0,80}\b(unidad|matricula|patente)\b/g)) {
    cutAt = Math.max(cutAt, (match.index ?? 0) + match[0].length);
  }
  for (const match of norm.matchAll(/\bno encuentro\b.{0,40}\b(unidad|patente|matricula)\b/g)) {
    cutAt = Math.max(cutAt, (match.index ?? 0) + match[0].length);
  }
  if (cutAt < 0) return text;
  const offset = text.length - tail.length;
  return text.slice(offset + cutAt);
}

/** El hilo reciente está pidiendo patente para un trámite de odómetro. */
export function threadAwaitingOdometerPlate(threadText: string): boolean {
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  if (hasPendingUnitConsultPlateRequest(threadText)) return false;
  const scoped = threadTailSinceFleetUnitSearch(threadText);
  const tail = scoped.slice(-2500).toLowerCase();
  if (hasPendingOdometerConfirmation(threadText)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  // Si el bot acaba de pedir patente/km para odómetro, el trámite sigue activo aunque
  // antes en el hilo hubo listado de flota o consulta GPS (bug 2026-07-27: "Pásame la
  // lista de mi flota" + cambio de odómetro + "La Ad 626 UG" caía a estado GPS).
  const botAwaitingOdometerData =
    /perfecto, tomo .+ cu[aá]l es el nuevo hor[oó]metro/i.test(tail) ||
    /perfecto, tomo .+ pasame el nuevo hor[oó]metro/i.test(tail) ||
    /cu[aá]l es el nuevo hor[oó]metro/i.test(tail) ||
    /nuevo hor[oó]metro en horas/i.test(tail) ||
    /pasame el nuevo hor[oó]metro en horas/i.test(tail) ||
    /perfecto, tomo .+ cu[aá]l es el nuevo od[oó]metro/i.test(tail) ||
    /perfecto, tomo .+ pasame el nuevo od[oó]metro/i.test(tail) ||
    /cu[aá]l es el nuevo valor de od[oó]metro/i.test(tail) ||
    /nuevo od[oó]metro en km/i.test(tail) ||
    /pasame el nuevo od[oó]metro en km/i.test(tail) ||
    /(?:entendido|correcta)\.{0,3}\s*(?:cu[aá]l es|decime|pas[aá]me).{0,80}(?:patente|matr[ií]cula|marca|nombre)/i.test(
      tail,
    ) &&
    /(?:od[oó]metro|hor[oó]metro|kilometraje|registrar el cambio)/i.test(tail) ||
    (/(?:cu[aá]l es|indic[aá]me|pas[aá]me|decime|necesito).{0,100}(?:patente|matr[ií]cula)/i.test(tail) &&
      /od[oó]metro|hor[oó]metro|kilometraje/i.test(tail) &&
      /(?:atilio|registrar el cambio|nuevo od[oó]metro)/i.test(tail));
  if (botAwaitingOdometerData) {
    if (odometerFlowPausedByLaterTramite(threadText)) return false;
    return true;
  }
  if (threadHasRecentUnitStatusConsultIntent(threadText)) return false;
  return false;
}

/** Números que identifican unidad (código interno / movil_id), no lectura de medidor — cualquier prefijo numérico. */
export function extractUnitCodeNumbersFromMessage(rawText: string): number[] {
  const out: number[] = [];
  const text = String(rawText ?? "");
  for (const m of text.matchAll(/\bunida[d]?\s+(?:n[°o.]?\s*)?(\d{5,7})\b/gi)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) out.push(n);
  }
  for (const m of text.matchAll(/\b(?:M|m)(\d{3})-(\d{2,3})\b/g)) {
    const n = parseInt(`${m[1]}${m[2]}`, 10);
    if (Number.isFinite(n)) out.push(n);
  }
  const compact = text.trim().replace(/[\s\-_.]+/g, "");
  if (/^\d{5,7}$/.test(compact)) {
    out.push(parseInt(compact, 10));
  }
  return out;
}

/** Descarta km/hs que en realidad son código de unidad (ej. 900114 tras "unidad"). */
export function stripMeterValuesMatchingUnitReference(
  rawText: string,
  values: { odometro?: number; horometro?: number },
): { odometro?: number; horometro?: number } {
  const unitCodes = new Set(extractUnitCodeNumbersFromMessage(rawText));
  if (!unitCodes.size) return values;
  let { odometro, horometro } = values;
  if (typeof odometro === "number" && unitCodes.has(odometro)) odometro = undefined;
  if (typeof horometro === "number" && unitCodes.has(horometro)) horometro = undefined;
  return { odometro, horometro };
}

/** Último "Tomé … (N km|h)" del bot en el tail del hilo. */
export function lastTomoMeterKindInThreadTail(
  threadText: string,
): "odometro" | "horometro" | null {
  const tail = threadText.slice(-2500);
  const matches = [...tail.matchAll(/tom[eé]\s+[^.\n]+?\(\s*([\d.,]+)\s*(km|h)\s*\)/gi)];
  if (!matches.length) return null;
  const unit = matches[matches.length - 1][2].toLowerCase();
  if (unit === "h") return "horometro";
  if (unit.startsWith("km")) return "odometro";
  return null;
}

/** Último encabezado WhatsApp estructurado 🛣 Odómetro vs ⏱ Horómetro en el tail. */
export function lastStructuredMeterKindInThreadTail(
  threadText: string,
): "odometro" | "horometro" | null {
  const tail = threadText.slice(-2500);
  let lastOdo = -1;
  let lastHoro = -1;
  for (const m of tail.matchAll(/🛣\s*\*[Oo]d[oó]metro\*/g)) {
    if (m.index != null) lastOdo = m.index;
  }
  for (const m of tail.matchAll(/⏱\s*\*[Hh]or[oó]metro\*/g)) {
    if (m.index != null) lastHoro = m.index;
  }
  if (lastOdo < 0 && lastHoro < 0) return null;
  return lastHoro > lastOdo ? "horometro" : "odometro";
}

/**
 * De todos los prompts del bot pidiendo odómetro u horómetro (texto plano + plantillas
 * WhatsApp estructuradas), ¿cuál aparece más tarde en el tail del hilo?
 */
export function lastAwaitingMeterPromptInTail(
  threadText: string,
): "odometro" | "horometro" | null {
  const tail = threadText.slice(-2500);
  const tailNorm = tail
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  type Marker = { kind: "odometro" | "horometro"; idx: number };
  const markers: Marker[] = [];
  const addNorm = (needle: string, kind: "odometro" | "horometro") => {
    const n = needle
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const idx = tailNorm.lastIndexOf(n);
    if (idx >= 0) markers.push({ kind, idx });
  };
  addNorm("para registrar el cambio de horometro necesito la patente", "horometro");
  addNorm("cual es el nuevo horometro en horas", "horometro");
  addNorm("cuantas horas de motor", "horometro");
  addNorm("pasame el valor del horometro", "horometro");
  addNorm("pasame el nuevo horometro", "horometro");
  addNorm("para registrar el cambio de odometro necesito la patente", "odometro");
  addNorm("cual es el nuevo odometro en km", "odometro");
  addNorm("cual es el nuevo valor de odometro", "odometro");
  addNorm("pasame el valor del odometro", "odometro");
  addNorm("pasame el nuevo odometro", "odometro");
  for (const m of tail.matchAll(/🛣️?\s*(?:\*[Oo]d[oó]metro\*|[Oo]d[oó]metro)/g)) {
    if (m.index != null) markers.push({ kind: "odometro", idx: m.index });
  }
  for (const m of tail.matchAll(/⏱️?\s*(?:\*[Hh]or[oó]metro\*|[Hh]or[oó]metro)/g)) {
    if (m.index != null) markers.push({ kind: "horometro", idx: m.index });
  }
  for (const m of tail.matchAll(/🔢\s*valor:\s*\*[\d.,]+\*\s*km/gi)) {
    if (m.index != null) markers.push({ kind: "odometro", idx: m.index });
  }
  for (const m of tail.matchAll(/🔢\s*valor:\s*\*[\d.,]+\*\s*hs/gi)) {
    if (m.index != null) markers.push({ kind: "horometro", idx: m.index });
  }
  if (!markers.length) return null;
  markers.sort((a, b) => b.idx - a.idx);
  return markers[0].kind;
}

function resolveAwaitingMeterKindInThread(threadText: string): "odometro" | "horometro" | null {
  return (
    lastTomoMeterKindInThreadTail(threadText) ??
    lastAwaitingMeterPromptInTail(threadText) ??
    lastStructuredMeterKindInThreadTail(threadText)
  );
}

function threadBotAskedMissingFechaHora(threadText: string): boolean {
  const tail = threadText.slice(-2500).toLowerCase();
  return (
    /me falta la .{0,12}fecha y hora.{0,12} de la lectura/i.test(tail) ||
    /me falta la fecha y hora de la lectura/i.test(tail)
  );
}

/** El bot pidió el nuevo odómetro en km (patente ya confirmada). */
export function threadAwaitingOdometerKmValue(threadText: string): boolean {
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  const scoped = threadTailSinceFleetUnitSearch(threadText);
  const tail = scoped.slice(-2500).toLowerCase();
  if (hasPendingOdometerConfirmation(threadText)) return false;
  if (threadBotAskedMissingFechaHora(scoped)) {
    const kind = resolveAwaitingMeterKindInThread(scoped);
    if (kind === "odometro") return true;
    if (kind === "horometro") return false;
  }
  const structuredKind = lastAwaitingMeterPromptInTail(scoped);
  const tailHasOdometerKmAsk =
    /pasame el valor del od[oó]metro|pasame el nuevo od[oó]metro|nuevo od[oó]metro en km|valor del od[oó]metro en \*?km|🔢/.test(
      tail,
    );
  if (structuredKind === "odometro" && tailHasOdometerKmAsk) return true;
  if (structuredKind === "horometro") return false;
  return (
    /perfecto, tomo .+ cu[aá]l es el nuevo od[oó]metro/i.test(tail) ||
    /perfecto, tomo .+ pasame el nuevo od[oó]metro/i.test(tail) ||
    /cu[aá]l es el nuevo od[oó]metro/i.test(tail) ||
    /cu[aá]l es el nuevo valor de od[oó]metro/i.test(tail) ||
    /nuevo od[oó]metro en km/i.test(tail) ||
    /pasame el nuevo od[oó]metro en km/i.test(tail) ||
    /pasame el valor del od[oó]metro/i.test(tail) ||
    /od[oó]metro en .{0,12}km/i.test(tail) ||
    /od[oó]metro en km,?\s*(y )?la fecha y (la )?hora/i.test(tail)
  );
}

/** El bot pidió el nuevo horómetro en horas (patente ya confirmada). */
export function threadAwaitingHorometerKmValue(threadText: string): boolean {
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  if (isOdometerFlowSuperseded(threadText)) return false;
  const scoped = threadTailSinceFleetUnitSearch(threadText);
  const tail = scoped.slice(-2500).toLowerCase();
  if (hasPendingOdometerConfirmation(threadText)) return false;
  if (threadBotAskedMissingFechaHora(scoped)) {
    const kind = resolveAwaitingMeterKindInThread(scoped);
    if (kind === "horometro") return true;
    if (kind === "odometro") return false;
  }
  const structuredKind = lastAwaitingMeterPromptInTail(scoped);
  const tailHasHorometerHsAsk =
    /pasame el valor del hor[oó]metro|pasame el nuevo hor[oó]metro|nuevo hor[oó]metro en horas|valor del hor[oó]metro en \*?hs|🔢/.test(
      tail,
    );
  if (structuredKind === "horometro" && tailHasHorometerHsAsk) return true;
  if (structuredKind === "odometro") return false;
  return (
    /perfecto, tomo .+ cu[aá]l es el nuevo hor[oó]metro/i.test(tail) ||
    /perfecto, tomo .+ pasame el nuevo hor[oó]metro/i.test(tail) ||
    /cu[aá]l es el nuevo hor[oó]metro en horas/i.test(tail) ||
    /pasame el nuevo hor[oó]metro en horas/i.test(tail) ||
    /pasame el valor del hor[oó]metro/i.test(tail) ||
    /hor[oó]metro en .{0,12}hs/i.test(tail) ||
    /hor[oó]metro en horas,?\s*(y )?la fecha/i.test(tail) ||
    /hor[oó]metro en horas,?\s*la fecha y la hora/i.test(tail) ||
    /tom[eé] la fecha.+?cu[aá]ntas horas de motor/i.test(tail)
  );
}

/** El hilo reciente pide patente o valor para un trámite de horómetro (no odómetro). */
export function threadAwaitingHorometerPlate(threadText: string): boolean {
  if (threadOdometerRegistrationCompleted(threadText)) return false;
  const scoped = threadTailSinceFleetUnitSearch(threadText);
  const tail = scoped.slice(-2500).toLowerCase();
  if (hasPendingOdometerConfirmation(threadText)) return false;
  return (
    /para registrar el cambio de hor[oó]metro necesito la patente/i.test(tail) ||
    /perfecto, tomo .+ cu[aá]l es el nuevo hor[oó]metro/i.test(tail) ||
    /cu[aá]l es el nuevo hor[oó]metro en horas/i.test(tail) ||
    /confirm[aá]s?\s+(?:la\s+)?patente/i.test(tail)
  );
}

/**
 * Bug real, producción 2026-07-28: "cambio de horometroa a la q empieza con MYQ" (typing
 * rápido en el celular, sin espacio entre "horometro" y la palabra siguiente) no matcheaba
 * \bhor[oó]metro\b porque no hay límite de palabra tras la "o" — el mensaje se perdía
 * entero y el bot lo ruteaba como consulta de GPS/estado en vez de arrancar el trámite.
 * Se separa la palabra clave pegada a la palabra siguiente antes de correr las regex de
 * intención (no toca nada que ya venga bien espaciado).
 */
function insertMissingSpaceAfterOdometerKeywords(t: string): string {
  return t.replace(/\b(od[oó]metro|hor[oó]metro|kilometraje|kil[oó]metros)([a-z])/g, "$1 $2");
}

/** Trámite explícito de horómetro sin pedir odómetro/km en el mismo mensaje. */
export function looksLikeHorometerOnlyIntent(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = insertMissingSpaceAfterOdometerKeywords(
    raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  );
  return (
    /\bhor[oó]metro\b/.test(t) &&
    !/\b(od[oó]metro|kilometraje|kil[oó]metros|\bkm\b)\b/.test(t)
  );
}

/** Reenvío explícito de certificado ya emitido. */
export function looksLikeExplicitCertificateResendRequest(value: string | undefined | null): boolean {
  const t = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");
  return (
    /\b(reenvi\w*|re envi|envia.*(otra vez|nuevamente|de nuevo)|mand(a|ame|alo).*(otra vez|nuevamente|de nuevo)|volver.*(enviar|mandar)|no me llego|no lo recibi|pasamelo de nuevo|ped[ií].*expl[ií]citamente.*reenvi\w*)\b/i.test(
      t,
    ) && /\b(certificado|cobertura|archivo|pdf|link|url|documento|lo|me|unidad)\b/i.test(t)
  );
}

/** Colapsa letras repetidas para tolerar typos de chat ("ceerrtificado" → "certificado"). */
export function collapseRepeatedLetters(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(.)\1+/g, "$1");
}

/** Distancia de edición (Levenshtein) — solo para palabras cortas/puntuales, no texto libre. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

/** Certificado de cobertura/monitoreo, incluyendo typos frecuentes en WhatsApp. */
export function looksLikeCertificateKeyword(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const n = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(certificado|certficado|cobertura|monitoreo|constancia|sertificado)\b/.test(n)) return true;
  const collapsed = collapseRepeatedLetters(raw);
  if (/\b(certificado|certficado|cobertura|monitoreo|constancia|sertificado)\b/.test(collapsed)) return true;
  // Bug real, producción 2026-07-28: "ceryficado" (typo de teclado sobre "certificado",
  // no una simple letra repetida) no matcheaba ninguna variante literal ni el colapso de
  // repetidas — el propio arranque del trámite de certificado quedaba sin ancla de
  // "certificado" en el hilo, rompiendo threadHasCertificateUnitPrompt más adelante.
  // Cualquier palabra de 9-13 letras a distancia de edición <=2 de "certificado" cuenta.
  return n
    .split(/[^a-z]+/)
    .some((word) => word.length >= 9 && word.length <= 13 && levenshteinDistance(word, "certificado") <= 2);
}

/**
 * Mantenimiento (preventivo/correctivo), incluyendo typos de teclado frecuentes en
 * WhatsApp. Bug real, producción 2026-07-28: "me ayudasa agendar un mantenimineto?"
 * (typo "mantenimineto", no una letra repetida) no matcheaba ningún \b(mantenimiento...)\b
 * literal en TODA la cadena de detección (looksLikeOperationalMaintenanceIntent,
 * looksLikeMaintenanceExplorationRequest, etc.) — el pedido de agendar mantenimiento
 * caía al fallback genérico de "consulta operativa" (unidades/GPS) en vez de arrancar
 * el trámite de mantenimiento, y terminaba mostrando el estado de ignición de la
 * unidad elegida en vez de agendar nada.
 */
export function looksLikeMaintenanceKeyword(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const n = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(mantenimiento|preventiv\w*|correctiv\w*)\b/.test(n)) return true;
  const collapsed = collapseRepeatedLetters(raw);
  if (/\b(mantenimiento|preventiv\w*|correctiv\w*)\b/.test(collapsed)) return true;
  // Solo "mantenimiento" tolera distancia de edición: es una palabra larga y única, sin
  // riesgo real de falso positivo. "preventivo"/"correctivo" quedan afuera de este
  // chequeo difuso a propósito — son más cortas y palabras comunes como "correcto"
  // caen a distancia 2 de "correctivo", lo que dispararía falsos positivos constantes.
  return n
    .split(/[^a-z]+/)
    .some((word) => word.length >= 10 && word.length <= 16 && levenshteinDistance(word, "mantenimiento") <= 2);
}

/** Bot pidió la unidad para un certificado (incluye mis-rutas a unidades). */
export function threadHasCertificateUnitPrompt(threadText: string): boolean {
  if (!threadText.trim()) return false;
  const lines = threadText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const tail = lines.slice(-12).join("\n").toLowerCase();
  if (/para el certificado de cobertura necesito la unidad/.test(tail)) return true;

  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 12; i--) {
    if (botLineAnchorsCertificateUnitAsk(lines[i])) return true;
  }
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 12; i--) {
    if (!botLineIsCertificateUnitClarification(lines[i])) continue;
    const prior = lines.slice(Math.max(0, i - 12), i).join("\n");
    if (
      looksLikeCertificateKeyword(prior) ||
      lines.slice(0, i).some((l) => botLineAnchorsCertificateUnitAsk(l))
    ) {
      return true;
    }
  }

  // Ancla: el "¿Cuál unidad?" genérico, pero SOLO cuando el pedido que lo motivó fue
  // de certificado (looksLikeCertificateKeyword sobre lo anterior).
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
    const line = lines[i].toLowerCase();
    if (/cu[aá]l unidad\?\s*pasame la matr[ií]cula/.test(line)) {
      const prior = lines.slice(Math.max(0, i - 8), i).join("\n");
      if (looksLikeCertificateKeyword(prior)) return true;
    }
  }

  // Bug real, producción 2026-07-28: tras "la q empieza con OST" (dentro de un trámite
  // de certificado ya anclado por un "¿Cuál unidad?" anterior en el hilo), la
  // resolución de flota responde con el mensaje GENÉRICO de aclaración de
  // prefijo/candidatos ("Encontré N unidades que empiezan con OST (...). Decime cuál
  // querés consultar/la patente exacta." o "Encontré varias unidades posibles. Decime
  // la matrícula exacta.") — el mismo texto compartido que usa la resolución de flota
  // para ESTADO/GPS/mantenimiento, sin mencionar "certificado" en ningún lado. Al no
  // reconocerse como continuación del certificado, certificateFlowState volvía a
  // "none" y la siguiente selección de unidad ("la OST226") se enrutaba al chequeo de
  // GPS/estado en vez de continuar el certificado — el cliente recibía un reporte de
  // ignición en vez de su certificado. Por eso: si HUBO un "¿Cuál unidad?" anclado a
  // certificado en algún punto anterior del hilo (no solo en la ventana de arriba),
  // cualquier "Encontré... unidades..." posterior sigue perteneciendo a ese mismo
  // trámite — no hace falta que repita la palabra "certificado". La supersesión por
  // cambio real de tema ya la filtra isCertificateFlowSuperseded en el caller.
  const hadCertUnitPromptEarlier = lines.some((l, i) => {
    if (!/cu[aá]l unidad\?\s*pasame la matr[ií]cula/.test(l.toLowerCase())) return false;
    const prior = lines.slice(Math.max(0, i - 8), i).join("\n");
    return looksLikeCertificateKeyword(prior);
  });
  if (!hadCertUnitPromptEarlier) return false;
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
    if (/encontr[eé].{0,90}unidad(es)?.{0,90}(decime|pasame|cu[aá]l)/.test(lines[i].toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** Cliente inicia trámite de odómetro/horómetro sin dar patente todavía. */
export function looksLikeOdometerIntentStart(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (looksLikeOdometerInfoRequest(raw)) return false;
  if (detectLoosePlate(raw) || detectPlate(raw)) return false;
  const t = insertMissingSpaceAfterOdometerKeywords(
    raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  );
  return (
    // Bug real, producción 2026-07-29: "Ahora quiero MODIFICAR el odometro" no arrancaba
    // el trámite de odómetro porque "modificar" no estaba en la lista de verbos — el
    // mensaje caía al fallback operativo genérico (executor "unidades"), que respondía
    // con GPS/estado en vez de pedir la unidad para el odómetro. El bot "perdía el hilo"
    // desde el primer mensaje, sin que hiciera falta ningún tema previo en el historial.
    //
    // Bug real, producción 2026-08-06: "me corregis el odometro del la unidad 2408437"
    // no matcheaba "\bcorregir\b" (conjugación rioplatense "corregís"/"corregime").
    // Caía a unidades y el agente pedía km como si 2408437 ya fuera unidad válida.
    /\b(actualizar|cambiar|cambio de|correg\w*|modificar|ajust\w*|registrar|realizar)\b/.test(t) &&
    /\b(od[oó]metro|hor[oó]metro|kilometraje|kil[oó]metros)\b/.test(t)
  );
}

/**
 * Solo menciona odómetro/horómetro sin decir qué hacer (ej. "ODOMETRO", "el odómetro").
 * Bug 2026-08-07: tras elegir unidad, "ODOMETRO" se ignoraba / se trataba como síntoma GPS
 * en vez de preguntar si quiere corregir km u otra cosa.
 */
export function looksLikeBareOdometerTopicMention(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 40) return false;
  if (looksLikeOdometerIntentStart(raw)) return false;
  if (looksLikeOdometerInfoRequest(raw)) return false;
  if (looksLikeOdometerProblemReport(raw)) return false;
  if (looksLikeOdometerHelpRequest(raw)) return false;
  if (detectLoosePlate(raw) || detectPlate(raw)) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[!?.¡¿]+/g, "")
    .trim();
  return /^(el\s+|la\s+|del\s+|sobre\s+(el\s+)?)?(od[oó]metro|hor[oó]metro|kilometraje)s?$/.test(t);
}

/**
 * Reinicio explícito del trámite de odómetro (no ampliación de datos sobre confirmación pendiente).
 * Bug 2026-07-27: "Quiero hacer un cambio de odometro" con confirmación vieja en el hilo
 * debe reiniciar; "Aun no te dije la hora del cambio" NO debe reiniciar.
 */
export function looksLikeFreshOdometerRestartRequest(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || !looksLikeOdometerIntentStart(raw)) return false;
  if (looksLikeOdometerPendingDataAmendment(raw)) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(quiero|necesito|hagamos|podemos|vamos a|deseo)\b/.test(t);
}

/** Ampliación o corrección sobre confirmación pendiente (fecha/hora/km/horómetro). */
export function looksLikeOdometerPendingDataAmendment(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Bug real, producción 2026-07-30: "Unidad: M600-020" tras confirmación con patente
  // del certificado (AF 061 DV) debe reabrir el trámite con la unidad nueva.
  if (/\bunidad\b/i.test(t) && /\b(?:M?\d{3}-\d{2,3})\b/i.test(raw)) return true;
  if (/\b(aun no te dije|todavia no|no te dije|me falta|faltaria|falta el|falta la)\b/.test(t)) return true;
  if (/\b(estan mal|esta mal|est[aá]n mal|incorrecta|incorrecto)\b/.test(t) && /\b(fecha|hora|dia)\b/.test(t)) {
    return true;
  }
  if (/\b(ayer|hoy|anteayer)\b/.test(t) && /\b(\d{1,2}:\d{2}|a las|hora)\b/.test(t)) return true;
  if (/\b(la fecha es|fecha es la|es la de hoy|es hoy|fecha correcta|la hora es|hora correcta)\b/.test(t)) {
    return true;
  }
  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(raw)) return true;
  if (
    /\b(hora|fecha|dia|kilometraje|km)\b/.test(t) &&
    /\b(od[oó]metro|hor[oó]metro|cambio de)\b/.test(t)
  ) {
    return true;
  }
  // Bug real, producción 2026-07-28: "corregir datos" tras el resumen de confirmación
  // solo tocaba el gancho de fecha/hora ("esta mal" + fecha/hora, etc.) — un valor nuevo
  // de odómetro/horómetro sin esas palabras (ej. "el horómetro correcto es 350",
  // "corrijo el odómetro a 12000") quedaba atrapado repitiendo el recordatorio de
  // CONFIRMO en vez de reabrir el trámite con el valor nuevo.
  if (/\b(od[oó]metro|hor[oó]metro)\b/.test(t) && /\d/.test(raw)) return true;
  // Bug real, producción 2026-07-29: "No es 152344" (rechazando el valor propuesto en el
  // resumen pendiente y dando el correcto) no mencionaba "odómetro"/"horómetro" ni
  // ninguno de los ganchos de arriba, así que caía en el recordatorio genérico de
  // CONFIRMO en vez de reabrir el trámite con el valor nuevo (152344). La IA de
  // resolveOdometerHorometerFields ya interpreta bien este caso con el contexto del
  // tramite activo — el problema era que nunca llegaba a ejecutarse.
  if (/\bno\b,?\s+(?:es|era|son|eran|fue|fueron)\b.{0,6}\d/.test(t)) return true;
  // Bug real, producción 2026-07-29: "Perdón me equivoqué es 17" corrigiendo el horómetro
  // propuesto no matcheaba ningún patrón — el resumen nuevo mostraba 17 pero al
  // confirmar se registraba el valor viejo del pendingAction (15).
  if (/\bme\s+(equivoqu|equivoco|confund[ií])/.test(t) && /\d/.test(raw)) return true;
  if (/\b(?:perdon|disculp\w*|error)\b/.test(t) && /\b(?:es|era)\b.{0,8}\d/.test(t)) return true;
  if (/\b(?:es|era|son|eran|fue|fueron)\b\s+\d{1,8}(?:[.,]\d{1,2})?\s*(?:km|hs|horas)?\b/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Intención genérica de corregir datos SIN especificar todavía cuál (ej. "corregir
 * datos", "quiero corregir eso", "hay un error", "corregilo"). Distinto de una
 * corrección de patente (looksLikePlateCorrectionRequest) o una que ya trae el valor
 * nuevo (looksLikeOdometerPendingDataAmendment) — acá el cliente todavía no dio nada
 * para actualizar, solo avisó que algo está mal.
 */
export function looksLikeGenericCorrectionIntent(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(corregir|modificar|cambiar|rectificar)\b.{0,20}\b(datos?|informaci[oó]n|eso|esto)\b/.test(t)) {
    return true;
  }
  if (/\bcorrij(o|amos|elo|ela)\b/.test(t)) return true;
  if (/\bcorregirlo|corregirla\b/.test(t)) return true;
  if (/\b(hay|tiene|tuvo)\b.{0,12}\b(un\s+)?error\b/.test(t)) return true;
  if (/\bquiero\s+corregir\b/.test(t) && !/\b(patente|matricula)\b/.test(t)) return true;
  // Bug real, producción 2026-07-29: "No me equivoqué" / "me equivoqué" (avisando que el dato
  // propuesto está mal, sin dar todavía el valor correcto) no matcheaba ningún patrón de
  // arriba y caía en el recordatorio genérico de CONFIRMO sin que el bot "entendiera" el
  // aviso de error.
  if (/\bme\s+(equivoqu|equivoco|confund[ií])/.test(t)) return true;
  return false;
}

/** Pregunta informativa sobre odómetro/horómetro — NO trámite operativo de registro. */
export function looksLikeOdometerInfoRequest(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!/\b(od[oó]metro|hor[oó]metro|kilometraje)\b/.test(t)) return false;
  if (/\b(quiero|necesito|hagamos|podemos|vamos a|deseo|confirmo|confirma)\s+(cambiar|modificar|registrar|actualizar)\b/.test(t)) {
    return false;
  }
  return (
    /\b(para que sirve|para q sirve|para que es|para q es|que es|que son|que significa|como funciona|como se hace|como se usa|me explicas|explicame|explic[aá]me|contame|decime|pod[eé]s explicar|me ayudas a entender|quiero entender|quiero saber|informacion|informaci[oó]n|diferencia entre|para que se usa)\b/.test(
      t,
    ) ||
    (/\b(para que|para q|que es|como)\b/.test(t) && /\b(sirve|funciona|significa)\b/.test(t))
  );
}

/** Reporte de falla/desfase del odómetro — no es trámite de actualizar km. */
export function looksLikeOdometerProblemReport(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (looksLikeStructuredOdometerUpdateRequest(raw)) return false;
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
  const t = insertMissingSpaceAfterOdometerKeywords(
    raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase(),
  );
  if (!/\b(od[oó]metro|hor[oó]metro|kilometraje)\b/.test(t)) return false;
  // Raíz del verbo en vez de lista cerrada de conjugaciones (mismo patrón de bug
  // corregido en waraApi.ts looksLikeOpcionesInfoRequest/looksLikeAtilioHelpRequest,
  // producción 2026-07-23): no cubría plural/3ra persona ("me ayudan con el odómetro").
  return (
    /\bayud\w*\b/.test(t) ||
    /\b(con mi|con el|con la)\b/.test(t)
  );
}

/** Plantilla operativa diaria: interno/nombre + km + fecha/hora — cambio de odómetro, no ticket. */
export function looksLikeStructuredOdometerUpdateRequest(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const hasUnitName = /\binterno\s*:\s*M?\d{3}-\d{2,3}\b/i.test(raw) || /\bM?\d{3}-\d{2,3}\b/i.test(raw);
  const hasKmField =
    /\bkm\s*actual\s*:\s*[\d.,]+/i.test(raw) ||
    /\b(?:odometro|odómetro|kilometraje)\s*:\s*[\d.,]+/i.test(raw);
  const hasKmInline = /\b[\d]{1,3}(?:\.[\d]{3})+\s*km\b/i.test(raw) || /\b\d{4,7}\s*km\b/i.test(raw);
  const hasDateOrTime = /\bfecha\s*:\s*\d/i.test(raw) || /\bhora\s*:\s*\d/i.test(raw);

  if (hasUnitName && (hasKmField || hasKmInline) && (hasDateOrTime || hasKmField)) return true;
  if (/\bmando\s+interno\b/i.test(raw) && /\bkm\b/i.test(raw) && (hasUnitName || hasKmField || hasDateOrTime)) {
    return true;
  }
  if (hasUnitName && hasKmField) return true;
  return false;
}

/** Mensaje actual pide trámite de actualización de odómetro (no guía ni otro módulo). */
export function looksLikeExplicitOdometerUpdateRequest(text: string | undefined | null): boolean {
  if (looksLikeOdometerProblemReport(text)) return false;
  if (looksLikeOdometerInfoRequest(text)) return false;
  if (looksLikeStructuredOdometerUpdateRequest(text)) return true;
  return looksLikeOdometerIntentStart(text) || looksLikeOdometerHelpRequest(text);
}

/**
 * El cliente recuerda/corrige al bot tras una respuesta equivocada ("te pedí un cambio de
 * horómetro") — NO es un arranque en blanco de trámite que deba vaciar el hilo.
 */
export function looksLikeOdometerFlowReminder(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!/\b(od[oó]metro|hor[oó]metro|kilometraje)\b/.test(t)) return false;
  return (
    /\bte ped[ií]\b/.test(t) ||
    /\byo te ped[ií]\b/.test(t) ||
    /\bte dije\b/.test(t) ||
    /\bte solicit[eé]\b/.test(t) ||
    /\bno te ped[ií]\b/.test(t) ||
    /\bquer[ií]a\b/.test(t)
  );
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
 * El bot está RECHAZANDO/no encontrando una patente (mensaje de error), no confirmando
 * una unidad vigente. Bug real, producción 2026-07-23: el cliente resolvió "Nissan" →
 * "tomo AG 562 SP", pero el bot igual intentó registrar el odómetro contra "OST 223"
 * porque su PROPIO mensaje de error ("No encontré la patente OST 223...") menciona esa
 * patente inválida, y al ser la línea más reciente del hilo, extractLastPlateFromThread
 * la tomaba como "la última patente vigente" — creando un loop autoalimentado: cada
 * respuesta de error volvía a "confirmar" (para el propio sistema) la patente rechazada,
 * sin importar lo que el cliente dijera después. Cualquier línea de rechazo/no-encontrado
 * debe ignorarse por completo al buscar la última patente real.
 */
export function lineLooksLikeBotPlateRejection(line: string): boolean {
  const l = line.trim();
  if (!l) return false;
  const norm = l
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /no encontre la patente/.test(norm) ||
    /no encontre esa unidad/.test(norm) ||
    /no hay ninguna unidad/.test(norm) ||
    /la patente .* no esta en la flota/.test(norm) ||
    (/no encontr/.test(norm) && /(patente|unidad|matricula)/.test(norm))
  );
}

/** El bot está pidiendo la patente (con ejemplos tipo "AB 006 EX") — no es una unidad confirmada. */
export function lineLooksLikeBotMissingPlatePrompt(line: string): boolean {
  const norm = line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hasExample = /(ej\.|ejemplo|marca\/nombre|por ejemplo)/.test(norm);
  if (!hasExample) return false;
  return (
    /para registrar el cambio de odometro necesito la patente/.test(norm) ||
    (/necesito la patente de la unidad/.test(norm) &&
      /odometro|horometro|kilometraje/.test(norm)) ||
    /para programar mantenimiento preventivo necesito la patente/.test(norm) ||
    /para registrar el mantenimiento necesito la patente/.test(norm) ||
    /pasame la matricula de la unidad/.test(norm) ||
    /para revisar el gps/.test(norm) ||
    /revisar el gps, la ignicion o el reporte/.test(norm) ||
    (/necesito la unidad/.test(norm) && /patente/.test(norm)) ||
    (/cual es la patente o unidad/.test(norm) && /matricula/.test(norm))
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
    if (lineLooksLikeBotPlateRejection(line)) continue;
    if (lineLooksLikeBotMissingPlatePrompt(line)) continue;
    const labeled = [
      ...line.matchAll(/(?:Patente|Matr[ií]cula|Unidad)[^\n:]*[:\-]\s*\*?([A-Za-z0-9 ]{5,12})/gi),
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

/**
 * Patente del resumen confirmado de odómetro/horómetro ("Patente: AD 427 MC").
 * Toma la última ocurrencia del hilo (resumen más reciente).
 */
/** Patente del cierre exitoso de mantenimiento ("deje registrada... patente AG562SP"). */
export function extractPlateFromMaintenanceSuccess(text: string): string | undefined {
  const tail = (text || "").slice(-4000);
  const matches = [
    ...tail.matchAll(/deje registrada[^.\n]{0,160}patente\s+([A-Za-z0-9 ]{5,12})/gi),
  ];
  for (let i = matches.length - 1; i >= 0; i--) {
    const plate = normalizePlate(matches[i][1]);
    if (plate && isPlausibleVehiclePlate(plate)) return plate;
  }
  return undefined;
}

export function extractPlateFromOdometerSummary(text: string): string | undefined {
  const matches = [
    ...(text || "").matchAll(
      /(?:patente|unidad con patente)\s*[:\-]?\s*([A-Z]{2}\s?\d{3}\s?[A-Z]{2}|[A-Z]{3}\s?\d{3})/gi,
    ),
  ];
  for (let i = matches.length - 1; i >= 0; i--) {
    const plate = normalizePlate(matches[i][1]);
    if (plate && !isExamplePlate(plate)) return plate;
  }
  return undefined;
}

function parseSummaryReading(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(String(raw).replace(/\./g, "").replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/** Odómetro del último bloque "Voy a registrar:" (resumen más reciente del hilo). */
export function extractOdometroFromOdometerSummary(text: string): number | undefined {
  const voyIdx = text.toLowerCase().lastIndexOf("voy a registrar");
  if (voyIdx < 0) {
    // Sin resumen de confirmación: no inventar km desde "Tomé … (10500 km)" del bot.
    return undefined;
  }
  const tail = text.slice(voyIdx);
  // Sin \s: evita "26\n99000" → 2699000 (bug 2026-08-05).
  const matches = [...tail.matchAll(/od[oó]metro[^\n:]*[:\-]\s*([\d.,]+)\s*(?:km)?/gi)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = parseSummaryReading(matches[i][1]);
    if (typeof n === "number") return n;
  }
  return undefined;
}

/** Km parafraseados por el agente ("el nuevo valor es 123690 km"). */
export function extractOdometroFromOdometerContext(text: string): number | undefined {
  // No tomar ejemplos ni "Tomé … (10500 km)" del bot (bug 2026-08-07).
  const tail = stripBotOdometerBotSpeech(text).slice(-2500);
  // Sin espacios en el run numérico: "05/08/26\n99000 km" no debe virar 2699000
  // (bug real, producción 2026-08-05).
  const patterns = [
    /(?:nuevo valor(?: del od[oó]metro)?|el od[oó]metro es|valor del od[oó]metro es|el nuevo valor es)\s*(?:de\s+)?([\d.,]+)\s*(?:km)?/gi,
    /(?:los\s+)?(?:kil[oó]metros?|kilometraje|km)\s*(?:son|es|de|:)?\s*([\d.,]+)/gi,
    /(\d[\d.,]{2,})\s*km\b/gi,
    /🔢\s*valor:\s*\*([\d.,]+)\*\s*km/gi,
  ];
  for (const re of patterns) {
    const matches = [...tail.matchAll(re)];
    for (let i = matches.length - 1; i >= 0; i--) {
      const n = parseSummaryReading(matches[i][1]);
      if (typeof n === "number" && n >= 100) return n;
    }
  }
  return undefined;
}

/** Horómetro del último bloque "Voy a registrar:" (resumen más reciente del hilo). */
export function extractHorometroFromOdometerSummary(text: string): number | undefined {
  const tail = text.slice(Math.max(0, text.lastIndexOf("voy a registrar")));
  const matches = [...tail.matchAll(/hor[oó]metro[^\n:]*[:\-]\s*([\d.\s,]+)\s*(?:h|hs|horas)?/gi)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = parseSummaryReading(matches[i][1]);
    if (typeof n === "number") return n;
  }
  return undefined;
}

/** Patente confirmada en "Perfecto, tomo …" o "Tomé … (N km|h)" del bot. */
export function extractPlateFromPerfectoTomo(text: string): string | undefined {
  const tryPlate = (raw: string | undefined): string | undefined => {
    const plate = normalizePlate(String(raw ?? "").replace(/\.\s*$/, "").trim());
    if (plate && isPlausibleVehiclePlate(plate) && !isExamplePlate(plate)) return plate;
    return undefined;
  };

  const perfectoMatches = [...(text || "").matchAll(/perfecto,\s*tomo\s+([A-Za-z0-9 ]{4,14})/gi)];
  for (let i = perfectoMatches.length - 1; i >= 0; i--) {
    const plate = tryPlate(perfectoMatches[i][1]);
    if (plate) return plate;
  }

  const tomeMatches = [
    ...(text || "").matchAll(
      /\btom[eé]\s+(?:el\s+d[ií]a\s+[\d./]+\s+para\s+)?([A-Za-z0-9 ]{4,14})(?:\s*\([\d.,]+\s*(?:km|h)\))?/gi,
    ),
  ];
  for (let i = tomeMatches.length - 1; i >= 0; i--) {
    const raw = tomeMatches[i][1]?.trim();
    if (!raw || /^(?:el|la|d[ií]a|para)\b/i.test(raw)) continue;
    const plate = tryPlate(raw);
    if (plate) return plate;
  }

  return undefined;
}

/** El bot avisó que la marca/patente buscada no está en la flota. */
export function threadHasFailedUnitSearch(threadText: string): boolean {
  const tail = threadText.slice(-3500).toLowerCase();
  return (
    /no encontr[eé] ninguna unidad/.test(tail) ||
    /no hay ninguna unidad en la flota/.test(tail) ||
    /ese prefijo no est[aá] en tu flota/.test(tail)
  );
}

/**
 * Resuelve patente de contexto para odómetro/horómetro sin pisar referencias vagas
 * ("la unidad mencionada") con resúmenes viejos de certificado u otro trámite.
 */
export function resolveOdometerContextPlate(params: {
  threadText: string;
  lastThreadPlate: string | null;
  activeUnitPlate?: string | null;
  explicitVagueUnitReference: boolean;
  hasPendingOdometerConfirm: boolean;
}): string {
  const summary = extractPlateFromOdometerSummary(params.threadText);
  const maintSuccess = extractPlateFromMaintenanceSuccess(params.threadText);
  const last = params.lastThreadPlate ?? undefined;
  const active = params.activeUnitPlate?.trim() || undefined;

  if (params.hasPendingOdometerConfirm) {
    return summary ?? maintSuccess ?? last ?? active ?? "";
  }
  // Sin confirmación pendiente: la unidad MÁS RECIENTE del hilo / activa manda sobre un
  // "Voy a registrar: Patente AD…" viejo (bug 2026-08-07: tras AG 807 PS el cliente dijo
  // CORREGIR ODOMETRO y el bot tomaba AD 555 BH de un registro anterior).
  if (params.explicitVagueUnitReference) {
    return last ?? active ?? summary ?? maintSuccess ?? "";
  }
  return last ?? active ?? summary ?? maintSuccess ?? "";
}

/** El bot acaba de pedir patente para un trámite operativo de mantenimiento. */
export function hasPendingMaintenancePlateRequest(threadText: string): boolean {
  if (certificateFlowState(threadText) === "awaiting_unit") return false;
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

/** El bot pidió patente/nombre para consultar una unidad (GPS, estado, búsqueda), no odómetro/mantenimiento/cert. */
export function hasPendingUnitConsultPlateRequest(threadText: string): boolean {
  if (certificateFlowState(threadText) !== "none") return false;
  if (hasPendingMaintenancePlateRequest(threadText)) return false;
  // Bug prod 2026-08-17: aclaración de matrícula en trámite horómetro ≠ consulta GPS.
  // No usar threadHasActiveOdometerFlow acá (recursión con threadAwaitingOdometerPlate).
  if (threadHasRecentCustomerMeterUpdateIntent(threadText)) {
    const meterTail = threadText.slice(-3500).toLowerCase();
    if (
      /matr[ií]cula exacta|confirm[aá].{0,30}matr[ií]cula|patente exacta|para registrar el cambio de hor[oó]metro|para registrar el cambio de od[oó]metro/.test(
        meterTail,
      )
    ) {
      return false;
    }
  }

  const lower = threadText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const unitConsultMarkers = [
    lower.lastIndexOf("para revisar el gps"),
    lower.lastIndexOf("cuál es la matrícula o el nombre"),
    lower.lastIndexOf("cual es la matricula o el nombre"),
    lower.lastIndexOf("indicame la matricula"),
    lower.lastIndexOf("indicáme la matrícula"),
    lower.lastIndexOf("matrícula exacta"),
    lower.lastIndexOf("matricula exacta"),
    lower.lastIndexOf("entendido, no era esa"),
    lower.lastIndexOf("decime la matrícula exacta"),
    lower.lastIndexOf("decime la matricula exacta"),
    lower.lastIndexOf("patente de la unidad que quer"),
    lower.lastIndexOf("patente de la unidad que quier"),
    lower.lastIndexOf("pasar la patente de la unidad"),
    lower.lastIndexOf("me podrias pasar la patente"),
    lower.lastIndexOf("me podrías pasar la patente"),
    lower.lastIndexOf("problema con la"),
    lower.lastIndexOf("indiques la patente"),
    lower.lastIndexOf("indicá la patente"),
    lower.lastIndexOf("indica la patente"),
    lower.lastIndexOf("patente completa de la"),
    lower.lastIndexOf("contame que problema"),
    lower.lastIndexOf("que problema estas viendo"),
    lower.lastIndexOf("que situacion estas viendo"),
    lower.lastIndexOf("ultima posicion de la"),
    lower.lastIndexOf("última posición de la"),
    lower.lastIndexOf("ultima posición de la"),
    lower.lastIndexOf("última posicion de la"),
    // Bug real 2026-08-03: pedido de otra unidad sin reporte ("Pasame la patente...
    // sin reporte") no matcheaba ningún marcador y threadAwaitingOdometerPlate lo
    // confundía con trámite de odómetro — "Perfecto, tomo AC 607 XB. ¿Cuál es el nuevo odómetro?"
    lower.lastIndexOf("otra unidad sin reporte"),
    lower.lastIndexOf("nombre de la otra unidad"),
    lower.lastIndexOf("pasame la patente o el nombre"),
    lower.lastIndexOf("la consulto en wara"),
    // Pedido LN vía info_guides / utterance ("¿Me podés dar la patente o el prefijo…?")
    lower.lastIndexOf("patente o el prefijo"),
    lower.lastIndexOf("patente o prefijo"),
    lower.lastIndexOf("me podes dar la patente"),
    lower.lastIndexOf("me podés dar la patente"),
    lower.lastIndexOf("pasame la patente"),
    lower.lastIndexOf("pasame la matricula"),
    lower.lastIndexOf("pasame la matrícula"),
  ].filter((i) => i >= 0);
  if (!unitConsultMarkers.length) return false;

  const lastUnitAsk = Math.max(...unitConsultMarkers);
  const odoMarkers = [
    lower.lastIndexOf("para registrar el cambio de horómetro"),
    lower.lastIndexOf("para registrar el cambio de horometro"),
    lower.lastIndexOf("para registrar el cambio de odómetro"),
    lower.lastIndexOf("para registrar el cambio de odometro"),
    lower.lastIndexOf("perfecto, tomo "),
    lower.lastIndexOf("cuál es el nuevo horómetro"),
    lower.lastIndexOf("cual es el nuevo horometro"),
    lower.lastIndexOf("cuál es el nuevo odómetro"),
    lower.lastIndexOf("cual es el nuevo odometro"),
  ].filter((i) => i >= 0);
  const lastOdo = odoMarkers.length ? Math.max(...odoMarkers) : -1;
  if (lastOdo >= 0 && lastOdo > lastUnitAsk) return false;

  const tail = lower.slice(lastUnitAsk, lastUnitAsk + 800);
  return (
    /para revisar el gps.*necesito la unidad/.test(tail) ||
    /(?:entendido, no era esa|cual es la otra unidad)/.test(tail) ||
    /(?:cual es la matricula|decime la matricula|matricula exacta|indic\w*me la matricula|pas\w*me la patente|marca\/nombre \(ej\.)/.test(
      tail,
    ) ||
    /(?:indic\w*|decime|pas\w*me|pasar|necesito que me).{0,40}patente/.test(tail) ||
    /(?:ultima)\s+posicion/.test(tail) ||
    /patente de la unidad que quer/.test(tail) ||
    /otra unidad sin reporte/.test(tail) ||
    /nombre de la otra unidad/.test(tail) ||
    /consulto en wara/.test(tail) ||
    /pasame la patente o el nombre/.test(tail) ||
    /patente o (?:el )?prefijo/.test(tail) ||
    /(?:me )?pode[s]?\s+dar la patente/.test(tail)
  );
}

/**
 * El cliente RECHAZA explícitamente la unidad que el bot acaba de mostrar/usar, sin
 * necesariamente nombrar la correcta ("no quiero ver esa, es otra", "no es esa", "esa
 * no es", "es otra unidad"). Superset de la vieja lista cerrada de frases con "otra
 * unidad/patente/vehículo/...".
 *
 * Por qué hace falta esto (bug real, producción 2026-07-23, MISMO hilo que shouldUseActiveUnitFallback):
 * tras resolver AG 562 SP, el cliente escribió "No quiero ver esa es otra" — no menciona
 * ninguna marca/patente alternativa, así que ni looksLikeFleetUnitSearchInput ni
 * looksLikePlateCorrectionRequest lo detectan, y el respaldo de "unidad activa" volvía a
 * devolver la MISMA unidad recién rechazada — loop infinito: cualquier mensaje sin marca
 * nueva reincide en el mismo resultado. Un rechazo explícito, aunque no traiga la
 * alternativa, tiene que bloquear TODA reutilización de contexto (unidad activa Y
 * patente vieja del hilo) y forzar a pedir la unidad de nuevo — nunca repetir la
 * rechazada.
 */
/**
 * El cliente amplía el tema a más unidades offline — no rechaza la unidad recién consultada.
 * Bug real, producción 2026-08-03: "Tengo otras unidades mas sin reporte" matcheaba
 * looksLikeUnitRejection ("otras unidades") y el bot respondía "Entendido, no era esa".
 */
/**
 * El cliente quiere consultar otra unidad distinta — no rechaza la anterior como incorrecta.
 * Bug real, producción 2026-08-03: "Quiero consultar por otra unidad" matcheaba
 * looksLikeUnitRejection y el bot respondía "Entendido, no era esa" en vez de pedir la otra.
 */
export function buildAnotherUnitConsultAskMessage(): string {
  return (
    "Entendido. ¿Cuál es la otra unidad? Pasame la patente, el código interno (ej. M900-093) " +
    "o la marca/nombre (ej. Nissan, Saveiro) y la consulto en Wara."
  );
}

export function looksLikeAnotherUnitConsultRequest(
  rawText: string | undefined | null,
): boolean {
  if (looksLikeAdditionalUnitsMissingReportRequest(rawText)) return false;
  const norm = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return false;
  if (/\bno\s+(es|era|son|eran)\s+(esa|ese|esta|este)\b/.test(norm)) return false;
  if (/\b(esa|ese|esta|este)\s+no\s+(es|era)\b/.test(norm)) return false;
  if (/\bno\s+era\s+esa\b/.test(norm)) return false;
  if (/\bno\s+quiero\s+(ver\s+)?(esa|ese|esta|este)\b/.test(norm)) return false;
  if (/\b(es|era)\s+otra\b/.test(norm) && !/\b(consult\w*|quiero|ver|revis\w*)\b/.test(norm)) {
    return false;
  }
  if (
    /^(quiero\s+)?(consultar\s+)?(por\s+)?(la\s+)?(otra|otro|otras|otros)\s+(unidad\w*|patente\w*|vehicul\w*|movil\w*|camionet\w*)\s*\.?$/.test(
      norm,
    ) ||
    /^(ver|revisar|chequear|mirar)\s+(la\s+)?(otra|otro)\s+(unidad\w*|vehicul\w*|patente\w*)\s*\.?$/.test(
      norm,
    ) ||
    /^(la\s+)?(otra|otro)\s+(unidad\w*|vehicul\w*|patente\w*|movil\w*)\s*\.?$/.test(norm) ||
    /\bcambiar\s+(de\s+)?(unidad|patente|vehicul\w*)\b/.test(norm) ||
    /\bpara\s+(la\s+)?(otra|otro)\s+(unidad\w*|patente\w*|vehicul\w*)\b/.test(norm)
  ) {
    return true;
  }
  return (
    /\b(consult\w*|revis\w*|cheque\w*|mir\w*|ver|estado|posicion|ubicacion)\w*\b.{0,40}\b(otra|otras|otro|otros)\s+(unidad\w*|patente\w*|vehicul\w*|camionet\w*)\b/.test(
      norm,
    ) ||
    (/\b(quiero|necesito|pasame|pasarme|dame|podes|puedes|podrias|podes)\b/.test(norm) &&
      /\b(otra|otras|otro|otros)\s+(unidad\w*|patente\w*|vehicul\w*|camionet\w*)\b/.test(norm)) ||
    (/\b(tengo|tambien|también)\b/.test(norm) &&
      /\b(otra|otras|otro|otros)\s+(unidad\w*|vehicul\w*|movile?s?|camionet\w*|patente\w*)\b/.test(norm)) ||
    /\bel\s+estado\s+de\s+(otra|otro)\s+(unidad\w*|patente\w*)\b/.test(norm)
  );
}

export function looksLikeAdditionalUnitsMissingReportRequest(
  rawText: string | undefined | null,
): boolean {
  const norm = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return false;
  if (
    !/\b(otra|otras|otro|otros)\s+unidad\w*\b/.test(norm) ||
    !/\b(sin reporte|sin reportar|no reporta|no reportan|offline)\b/.test(norm)
  ) {
    return false;
  }
  return (
    !/\bno\s+(es|era|son|eran)\s+(esa|ese|esta|este)\b/.test(norm) &&
    !/\b(esa|ese|esta|este)\s+no\s+(es|era)\b/.test(norm) &&
    !/\bno\s+era\s+esa\b/.test(norm) &&
    !/\bno\s+quiero\s+(ver\s+)?(esa|ese|esta|este)\b/.test(norm)
  );
}

export function looksLikeUnitRejection(rawText: string | undefined | null): boolean {
  if (looksLikeAdditionalUnitsMissingReportRequest(rawText)) return false;
  if (looksLikeAnotherUnitConsultRequest(rawText)) return false;
  const norm = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return false;
  return (
    // Generalizado a raíz + plural/género (\w*) en vez de un catálogo cerrado de frases
    // exactas. Bug real, producción 2026-07-23: "Quiero consultar por OTRAS unidades"
    // (plural, pidiendo unidades DISTINTAS a la activa) no matcheaba "otra unidad"
    // (singular) y el respaldo de unidad activa volvía a repetir la misma unidad recién
    // mostrada, como si el cliente hubiese preguntado por su estado otra vez.
    /\b(otra|otro|otras|otros|segunda|segundo)\s+(unidad\w*|vehicul\w*|patente\w*|camionet\w*|movile?s?)\b/.test(
      norm,
    ) ||
    /\btengo\s+otra\b/.test(norm) ||
    /\bno\s+(es|era|son|eran)\s+(esa|ese|esta|este)\b/.test(norm) ||
    /\b(esa|ese|esta|este)\s+no\s+(es|era)\b/.test(norm) ||
    /\bno\s+quiero\s+(ver\s+)?(esa|ese|esta|este)\b/.test(norm) ||
    /\bno\s+es\s+(la|el)\s+(correcta|correcto)\b/.test(norm) ||
    /\b(es|era)\s+otra\b/.test(norm) ||
    /\bno\s+(me\s+)?refier\w*\b/.test(norm) ||
    /\bno\s*,?\s+no\s+(me\s+)?refier\w*\b/.test(norm) ||
    looksLikeBareNegativeResponse(rawText) ||
    // Bug real, producción 2026-07-23: "No de otra" (forma coloquial de "no, es de otra
    // unidad") no matcheaba ninguna variante de arriba y el respaldo de unidad activa
    // volvía a repetir la misma unidad recién rechazada.
    /\bde\s+otra\b/.test(norm)
  );
}

export type CertificateFlowState = "awaiting_unit" | "awaiting_confirm" | "none";

/**
 * El cliente siguió con otra cosa (consulta de GPS/estado, odómetro, mantenimiento,
 * otra guía) DESPUÉS de que el certificado pidiera la unidad. La frase del bot ("para
 * el certificado de cobertura necesito la unidad...") sigue dentro de la ventana de
 * 12 líneas que mira certificateFlowState más abajo, pero el trámite real quedó
 * abandonado — no corresponde seguir enrutando mensajes nuevos hacia ese trámite viejo.
 *
 * Bug real, producción 2026-07-23: tras "¿qué unidad estamos viendo?" (certificado pide
 * la unidad) el cliente preguntó "quiero ver el estado de mi unidad" (otro trámite,
 * respondido con el estado GPS de una unidad) y después corrigió "no era esa, era la
 * Nissan" — como esa corrección menciona una marca (looksLikeVehicleBrandOrUnitSearch),
 * certificateFlowState todavía devolvía "awaiting_unit" (la frase seguía en las últimas
 * 12 líneas) y el router mandaba la corrección al certificado, que contestó "ya fue
 * enviado" — totalmente fuera de contexto de lo que el cliente estaba corrigiendo.
 */
export function isCertificateFlowSuperseded(threadText: string): boolean {
  if (!threadText.trim()) return false;
  const lower = threadText.toLowerCase();
  const markers = [
    lower.lastIndexOf("para el certificado de cobertura necesito la unidad"),
    lower.lastIndexOf("voy a generar el certificado de cobertura"),
    lower.lastIndexOf("confirmar certificado"),
  ].filter((i) => i >= 0);
  if (markers.length === 0) return false;
  const cutIdx = Math.max(...markers);
  const after = threadText
    .slice(cutIdx + 80)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!after.trim()) return false;
  return (
    /(esta detenida|esta funcionando normalmente|la ignicion|ultima posicion|no se generara un ticket|reportando y posicion)/.test(
      after,
    ) ||
    /\b(odometro|horometro|mantenimiento|preventiv\w*|correctiv\w*)\b/.test(after) ||
    /(modulo opciones|modulo unidades|agenda de contactos|mis atajos)/.test(after) ||
    /\bde nada\b/.test(after) ||
    // Bug real, producción 2026-07-27: tras "Perfecto, generé el certificado de
    // cobertura..." (trámite YA resuelto), el resumen previo ("Voy a generar...
    // responde CONFIRMO") seguía dentro de la ventana de 12 líneas que mira
    // certificateFlowState, así que un mensaje NUEVO sin relación ("ahora me das su
    // estado?") volvía a caer en "awaiting_confirm" y el bot repetía "para generar el
    // certificado respondé CONFIRMO" en loop, aunque el certificado ya se hubiese
    // emitido/resuelto minutos antes.
    /genere el certificado de cobertura/.test(after) ||
    /ya fue enviado/.test(after) ||
    /no pude (emitir|generar|validar) (el certificado|la sesion)/.test(after) ||
    /necesito que elijas la empresa/.test(after)
  );
}

/** Certificado ya emitido en el hilo reciente — no reabrir CONFIRMO pendiente. */
export function threadHasRecentCertificateSuccess(threadText: string): boolean {
  const tail = normThreadText(threadText.slice(-6000));
  return /(?:perfecto,? )?genere el certificado de cobertura/.test(tail);
}

/** Mantenimiento ya registrado en el hilo reciente. */
export function threadHasRecentMaintenanceSuccess(threadText: string): boolean {
  const tail = normThreadText(threadText.slice(-6000));
  return /deje registrada|mantenimiento registrado|registro registrado|listo,? registre el mantenimiento/.test(
    tail,
  );
}

/** Estado del trámite de certificado según mensajes recientes del hilo. */
export function certificateFlowState(threadText: string): CertificateFlowState {
  if (isCertificateFlowSuperseded(threadText)) return "none";
  if (threadHasRecentCertificateSuccess(threadText)) return "none";
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
    (/voy a generar el certificado de cobertura|confirmar certificado/.test(tail) &&
      /respond[eé]\s+\**confirmo/.test(tail)) ||
    (/voy a generar el certificado de cobertura/.test(tail) && /responde\s+confirmo/.test(tail))
  ) {
    return "awaiting_confirm";
  }
  if (threadHasCertificateUnitPrompt(threadText)) {
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

/** Valor numérico solo (km u horas) durante trámite de odómetro/horómetro. */
export function looksLikeBareMeterValue(text: string | undefined | null): boolean {
  const t = String(text ?? "").trim();
  return /^\d{1,7}$/.test(t);
}

/** El bot acaba de pedir km u horas (patente ya confirmada). */
export function threadHasActiveMeterValueRequest(threadText: string): boolean {
  return threadAwaitingHorometerKmValue(threadText) || threadAwaitingOdometerKmValue(threadText);
}

function maintenanceConfirmSummaryPending(tail: string, summaryStart: number): boolean {
  const block = tail.slice(summaryStart, summaryStart + 1200);
  if (/odometro|horometro|kilometraje/.test(block)) return false;
  if (!/tipo:/.test(block) || !/respond[eé]\s+\*?confirmo/.test(block)) return false;
  // Bug real, producción 2026-07-30: tras completar horómetro ("Listo, registré el cambio…")
  // y arrancar mantenimiento en la misma sesión, el chequeo global en los últimos 800
  // caracteres del hilo veía el cierre del horómetro y devolvía false — "Confirmó" volvía
  // a mostrar el resumen en loop. Solo anular si el mantenimiento quedó registrado
  // DESPUÉS de este resumen pendiente.
  const afterSummary = tail.slice(summaryStart + 30);
  if (/deje registrada|mantenimiento registrado|registro registrado/.test(afterSummary)) {
    return false;
  }
  return true;
}

export function hasPendingMantenimientoConfirmation(threadText: string): boolean {
  // Odómetro/horómetro en curso manda sobre un resumen viejo de mantenimiento en el hilo.
  if (threadHasActiveMeterValueRequest(threadText) || threadHasActiveOdometerFlow(threadText)) {
    return false;
  }
  const tail = normThreadText(threadText.slice(-4000));
  const newStart = tail.lastIndexOf("confirmar mantenimiento");
  if (newStart >= 0 && maintenanceConfirmSummaryPending(tail, newStart)) return true;
  const legacyStart = tail.lastIndexOf("voy a registrar:");
  if (legacyStart >= 0 && maintenanceConfirmSummaryPending(tail, legacyStart)) return true;
  return false;
}

/**
 * Detalle del resumen "Voy a registrar:" de mantenimiento (último CONFIRMO pendiente).
 * Sirve para reencaminar si el cliente dijo "No" y en realidad pedía una consulta.
 */
export function extractPendingMaintenanceDetalle(threadText: string): string | null {
  if (!hasPendingMantenimientoConfirmation(threadText)) return null;
  const tail = threadText.slice(-4000);
  const matches = [...tail.matchAll(/Detalle:\s*\*?(.+)/gi)];
  const last = matches.at(-1)?.[1]?.trim();
  if (!last) return null;
  return last.replace(/\*+$/, "").split("\n")[0]?.trim() || null;
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
    /un asesor de atenci[oó]n al cliente/.test(tail) ||
    /sumar algo m[aá]s al reclamo/.test(tail)
  );
}

/** Cliente agrega detalle a un caso ya derivado — no reabrir consulta GPS/unidades. */
export function looksLikePostAdvisorCaseSupplement(
  text: string | undefined | null,
  threadText: string | undefined | null,
): boolean {
  if (!looksLikePostAdvisorCaseThread(threadText)) return false;
  const n = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!n || n.length > 500) return false;
  if (/^(si|sí|dale|ok)\b/.test(n) && n.length > 4) return true;
  if (/\b(hoy mismo|urgente|sumar|agregar|unidades sin reportar|sin reportar|solucionado)\b/.test(n)) {
    return true;
  }
  // Bug real 2026-08-20: "NO REPORTA ETAPAS…" / "tampoco revisa cumplimiento de etapas"
  // tras caso abierto → anotar al asesor (no guía Opciones ni flota).
  if (
    /\b(no reporta|sin reporte|falta de reporte|offline|etapas|cumplimiento|recorrido|historial|vuelta|javier|informado)\b/.test(
      n,
    ) &&
    !/\b(abrir|crear|generar)\b.{0,20}\b(nuevo|otra?)\b.{0,15}\b(caso|ticket|reclamo)\b/.test(n)
  ) {
    return true;
  }
  return false;
}

function stripLeadingAffirmationPrefix(raw: string): string {
  let s = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^ahora\s+(si|sí)\s*,?\s*/i, "")
    .trim();
  if (/^dale\s+(porfa|porfavor|porfis|nom[aá]s|nomas)\b/i.test(s)) return s;
  return s.replace(/^(bueno|ok|dale|che)\s+,?\s*/i, "").trim();
}

/** Typos y abreviaturas rioplatenses antes de matchear confirmación breve. */
function normalizeColloquialInboundForConfirm(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bvancame\b/g, "avanzame")
    .replace(/\bbamcame\b/g, "avanzame")
    .replace(/\bavanza me\b/g, "avanzame")
    .replace(/\bmete le\b/g, "metele")
    .replace(/\bnomas\b/g, "nomás");
}

/** Coloquialismos argentinos de visto bueno (interpretar, no imitar al responder). */
export function looksLikeColloquialArgentineAffirmation(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 80) return false;
  const norm = normalizeColloquialInboundForConfirm(stripLeadingAffirmationPrefix(raw));
  if (!norm) return false;
  if (/^bancame(\s+(un\s+toque|ahi|a\s*hi|por\s*favor|pf))?$/i.test(norm)) return false;
  if (/^gracias(\s+(genial|joya|che|atilio|atili[oó]))?$/i.test(norm)) return false;
  const compact = norm.replace(/[^a-z]/g, "");
  if (
    new Set([
      "joya",
      "joyita",
      "genial",
      "barbaro",
      "barbara",
      "obvio",
      "claro",
      "deuna",
      "dalenomás",
      "dalenomas",
      "metele",
      "porfa",
      "porfavor",
      "porfis",
      "avanzame",
      "avanzá",
      "avanza",
      "mandale",
      "mandale nomás",
      "hacelo",
      "registralo",
      "registralo nomás",
      "siporfa",
      "siporfavor",
      "daleporfa",
      "daleporfavor",
    ]).has(compact)
  ) {
    return true;
  }
  return (
    /^(dale|si|sip|ok|joya|genial|barbaro|obvio|claro|de una|metele|avanza|avanzame|mandale|hacelo|registralo)(\s+(porfa|porfavor|porfis|nomás|nomas|che))*$/.test(
      norm,
    ) ||
    /^(porfa|porfavor|porfis)$/.test(norm) ||
    /\b(dale|si|sip)\s+(porfa|porfavor|porfis)\b/.test(norm)
  );
}

/** Aceptación breve tipo CONFIRMO / sí / dale / ok. */
export function looksLikeBriefConfirmation(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  if (looksLikeColloquialArgentineAffirmation(raw)) return true;
  const stripped = stripLeadingAffirmationPrefix(raw);
  const t = stripped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!t) return false;
  // "confirmo" y typos WhatsApp: comnfirmo, confimo, confimro, etc.
  if (looksLikeFuzzyConfirmoToken(t)) return true;
  if (
    new Set([
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
      "ahorasi",
      "ahorasiperfecto",
      "sperfecto",
      "siperfecto",
    ]).has(t)
  ) {
    return true;
  }
  const norm = stripped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(no\s+es\s+correcto|no\s+confirmo|incorrecto|no\s+est[aá]\s+bien)\b/.test(norm)) {
    return false;
  }
  // Afirmaciones naturales en confirmación de trámite (no exigen la palabra CONFIRMO).
  return (
    /\b(esa\s+(esta\s+)?(bien|es|correcta)|si\s+esa|est[aá]\s+bien|es\s+correcto|as[ií]\s+es|dale\s+esa|esa\s+misma)\b/.test(
      norm,
    ) || /\b(de\s+acuerdo|correcto\s+eso|esta\s+bien)\b/.test(norm)
  );
}

/**
 * Token único cercano a "confirmo" (typos de teclado / letras de más).
 * Bug real 2026-08-21: "comnfirmo" no arranca con "conf" → se tomaba como detalle.
 */
export function looksLikeFuzzyConfirmoToken(token: string | undefined | null): boolean {
  const t = String(token ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!t) return false;
  if (t.startsWith("conf") && t.length >= 5 && t.length <= 14) return true;
  if (t.length < 6 || t.length > 12) return false;
  return levenshteinDistance(t, "confirmo") <= 2;
}

/**
 * Ante un CONFIRMO pendiente el cliente pide ayuda o no entiende el paso
 * ("como puedo hacer?", "no entiendo que queres hacer?") — no es detalle del trámite.
 */
export function looksLikePendingConfirmHelpOrConfusion(
  text: string | undefined | null,
): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 180) return false;
  if (looksLikeBriefConfirmation(raw) || looksLikeFuzzyConfirmoToken(raw)) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/\b(cancel|desestim|no confirmo|olvidalo|dejalo)\b/.test(t)) return false;
  return (
    /\b(no entiendo|no te entiendo|no comprendo|estoy perdido|me perdi|me confundi)\b/.test(t) ||
    /\b(que|q)\s+(hago|tengo que hacer|debo hacer|respondo|contesto|tengo que poner)\b/.test(t) ||
    /\b(como|como hago|como puedo|como sigo)\b.{0,40}\b(hacer|hago|sigo|confirmar|registrar)?\b/.test(
      t,
    ) ||
    /\b(como puedo hacer|como hago|como sigo|y ahora que|y ahora que hago)\b/.test(t) ||
    /\b(que|q)\s+(queres|quiere|quieren)\s+(que\s+)?(haga|hacer|diga|responda|conteste)\b/.test(
      t,
    ) ||
    /\b(ayuda|ayudame|explicame|explicame que|no se que hacer|no se que responder)\b/.test(t)
  );
}

/**
 * "Si 19:00 de ayer", "Sí correcto", "Dale esa está bien" — afirmación con dato extra
 * durante confirmación pendiente. No es confirmación pura ni un trámite nuevo.
 */
/**
 * Tras una consulta lateral (qué es el odómetro, etc.), el cliente pide retomar
 * el CONFIRMO pendiente: "continuamos", "bueno seguimos porfa".
 * No es CONFIRMO (no registrar) ni cambio de empresa ("continuar con El Cacique").
 */
export function looksLikeResumePausedTramite(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 120) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/\b(con|en)\s+(el|la)?\s*(wara|cacique|empresa)\b/.test(t)) return false;
  if (/\bno\s+(continu|seguir|retom)/.test(t) || /\bcancel/.test(t)) return false;
  return /\b(continuamos|continuar|continuemos|seguimos|sigamos|retomamos|retomar|retomemos|volvamos)\b/.test(
    t,
  );
}

/** "Ah entiendo" / "ah ok" corto después de una explicación, con CONFIRMO aún vivo. */
export function looksLikePendingConfirmComprehensionAck(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 48) return false;
  const t = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (/\b(pasa|cambio|odometro|horometro|patente|confirmo|consulta|lista)\b/.test(t)) {
    return false;
  }
  return /^(ah|aha|aja|ok|bueno|bien)?\s*(entiendo|entendido|claro)(\s+(gracias|ok|dale))?$/.test(t) ||
    /^(ah ok|ah bueno|ah claro|ok entiendo)$/.test(t);
}

export function looksLikePendingTramiteAffirmation(text: string | undefined | null): boolean {
  if (looksLikeBriefConfirmation(text)) return true;
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 140) return false;
  const norm = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    !/^(si|sip|sii|dale|ok|okey|listo|perfecto|confirmo|confirma|de acuerdo|joya|genial|porfa|porfavor|porfis|avanza|avanzame|obvio|claro)\b/.test(
      norm,
    ) &&
    !/^ahora\s+(si|sí)\b/.test(norm) &&
    !looksLikeColloquialArgentineAffirmation(raw)
  ) {
    return false;
  }
  if (/\b(quiero|necesito|puedo|podemos|vamos a|ahora puedo|tambien|tambi[eé]n)\b/.test(norm)) {
    return false;
  }
  if (looksLikeFreshOdometerRestartRequest(raw)) return false;
  return true;
}

export function hasPendingCertificateUnitRequest(
  threadText: string,
  pendingAction?: { type?: string; payload?: Record<string, unknown> } | null,
): boolean {
  if (
    pendingAction?.type === "certificados" &&
    pendingAction.payload?.stage === "awaiting_unit"
  ) {
    return true;
  }
  return certificateFlowState(threadText) === "awaiting_unit";
}

/** Respuesta del cliente que continúa identificando la unidad en trámite de certificado. */
export function shouldContinueCertificateUnitCollection(
  text: string,
  threadText: string,
  pendingAction?: { type?: string; payload?: Record<string, unknown> } | null,
): boolean {
  if (!hasPendingCertificateUnitRequest(threadText, pendingAction)) return false;
  if (looksLikeCertificateUnitReply(text, threadText)) return true;
  const norm = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return false;
  if (/^(es|era)\s+(la|el)\s+unidad\b/.test(norm)) return true;
  const compact = norm.replace(/[\s\-_.]+/g, "");
  if (/^\d{5,7}$/.test(compact)) return true;
  if (extractUnitCodeNumbersFromMessage(text).length > 0) return true;
  if (detectLoosePlate(text) || isBarePlatePrefixHint(text)) return true;
  return false;
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
  const compact = text.trim().replace(/[\s\-_.]+/g, "");
  if (/^\d{5,7}$/.test(compact)) return true;
  if (extractUnitCodeNumbersFromMessage(text).length > 0) return true;
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
  if (
    /\b(no reporta|no me reporta|no le reporta|dejo de reportar|sin reporte|sin reportar|falta de reporte|offline|sin señal|sin senal|no actualiza|última señal|ultima señal|no registra ubicaci[oó]n)\b/.test(
      lower,
    )
  ) {
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
  // "usuario"/"plataforma"/"acceso" solos son demasiado genéricos — matchean también
  // preguntas informativas ("qué tipos de usuarios hay", "cómo son los perfiles de
  // usuarios") que no son un problema real. Exigimos que aparezca junto a lenguaje de
  // problema real (bug real, producción 2026-07-23: derivaba a ticket humano en vez de
  // responder la guía de Opciones/Perfiles).
  if (
    /(acceso|login|usuario|contraseñ|plataforma)/.test(lower) &&
    // Bug real, producción 2026-07-29: "no me está funcionando la plataforma" NO
    // matcheaba porque el patrón exigía la frase literal "no funciona" pegada — con un
    // pronombre en el medio ("no ME ESTÁ funcionando") ya no matcheaba, y el mensaje caía
    // en el executor de unidades (reporte de GPS de la última unidad activa) en vez de
    // derivarse a un asesor. Pedido explícito: este caso (funcionamiento/acceso a la
    // plataforma) debe ser SIEMPRE un disparador de derivación a asesor. Ahora "no" y el
    // verbo pueden tener palabras en el medio (pronombres, "está/esta"), y se agrega la
    // frase "imposibilidad de ingresar/acceder/entrar" (tal cual la usa el equipo).
    (/\bno\b.{0,15}\b(puedo|podemos|pueden|logro|logramos|deja\w*|anda\w*|funcion\w*|entra\w*|ingresa\w*|carga\w*|conecta\w*)\b/.test(
      lower,
    ) ||
      /\bimposibilidad\s+de\b.{0,20}\b(ingresar|acceder|entrar|conectar\w*)\b/.test(lower) ||
      /\b(bloquead\w*|olvid\w*|error|problema)\b/.test(lower))
  ) {
    return "ACCESS_PLATFORM";
  }
  if (/no puedo entrar/.test(lower)) {
    return "ACCESS_PLATFORM";
  }
  if (/(factur|administraci[oó]n|cobro|pago)/.test(lower)) {
    return "ADMIN_DERIVATION";
  }
  // Hardware / reclamo fuera de telemetría (pantalla táctil, etc.) → soporte humano.
  if (
    /\b(pantalla|t[aá]ctil|touch|display|teclado|hardware|garant[ií]a)\b/.test(lower) &&
    /\b(reclam\w*|falla|mal|rota|roto|no funciona|problema|aver[ií]a|defectu)\b/.test(lower)
  ) {
    return "GENERAL_TECH";
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

