/**
 * Prefijos/sufijos de patente en lenguaje natural (portado de V1 wara.ts).
 */
import { detectLoosePlate, isPlausibleVehiclePlate, normalizeLoosePlate } from "./plates.js";
import { looksLikeBriefConfirmation } from "./brief-replies.js";

const NON_PLATE_PREFIX_WORDS = new Set([
  "que", "los", "por", "con", "una", "uno", "eso", "esa", "ese", "el", "la", "las",
  "unos", "unas", "de", "del", "al", "en", "para", "a", "no", "nop", "nope", "nel", "nah", "veo",
  "si", "sii", "sip", "dale", "ok", "okey", "listo", "yes",
  "es", "su", "sus", "ha", "he", "mi", "ya", "va", "da",
]);

const EMPIEZA_RE = "emp(?:ie|i|e)za(?:n)?";
const COMIENZA_RE = "com(?:ie|i|e)nza(?:n)?";

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

const STARTS_WITH_VERBS = [
  "comienza", "comienzan", "empieza", "empiezan", "arranca", "arrancan", "inicia", "inician",
] as const;

function tokenLooksLikeStartsWithVerb(token: string): boolean {
  const t = token.replace(/[^a-z]/g, "");
  if (t.length < 5 || t.length > 12) return false;
  for (const verb of STARTS_WITH_VERBS) {
    const maxDist = verb.length <= 6 ? 2 : 3;
    if (levenshtein(t, verb) <= maxDist) return true;
  }
  if (/^c[ov]?o?m?\w{0,4}n?za$/.test(t) && t.includes("z")) return true;
  if (/^emp\w{0,4}za$/.test(t)) return true;
  return false;
}

function extractPlatePrefixAfterFuzzyStartsVerb(norm: string): string | null {
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokenLooksLikeStartsWithVerb(tokens[i]!)) continue;
    let j = i + 1;
    while (j < tokens.length && /^(?:con|cn|c)$/.test(tokens[j]!)) j++;
    const cand = tokens[j];
    if (!cand) continue;
    if (!/^[a-z]{2,3}\d{0,4}$/.test(cand)) continue;
    if (NON_PLATE_PREFIX_WORDS.has(cand)) continue;
    const hint = cand.toUpperCase();
    if (isPlausibleVehiclePlate(hint)) continue;
    return hint;
  }
  return null;
}

export function isBarePlatePrefixHint(text: string | undefined | null): boolean {
  if (looksLikeBriefConfirmation(text)) return false;
  const stripped = String(text ?? "")
    .trim()
    .replace(/^(la|el|esa|ese)\s+/i, "");
  const compact = stripped.replace(/[\s\-_.]+/g, "").toUpperCase();
  if (NON_PLATE_PREFIX_WORDS.has(compact.toLowerCase())) return false;
  if (!/^[A-Z]{2,3}\d{0,4}$/.test(compact)) return false;
  return !isPlausibleVehiclePlate(compact);
}

/** Prefijo en frases como "la que empieza con AD", "con AA82", o "AD" suelto. */
export function extractPlatePrefixFromMessage(rawText: string | undefined | null): string | null {
  const norm = String(rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return null;

  if (isBarePlatePrefixHint(rawText)) {
    return String(rawText ?? "")
      .trim()
      .replace(/^(la|el|esa|ese)\s+/i, "")
      .replace(/[\s\-_.]+/g, "")
      .toUpperCase();
  }

  const laQue = norm.match(
    new RegExp(
      `\\b(?:la|el|esa|ese|alguna|algunas|algun|algún)?\\s*(?:patente|patentes|unidad|unidades|dominio|dominios)?\\s*(?:q|que)\\s+(?:${EMPIEZA_RE}|${COMIENZA_RE}|arran(?:que|ca|can)|inici(?:a|an))\\s+(?:con|en\\s+)?([a-z0-9]{2,6})\\b`,
    ),
  );
  if (laQue?.[1] && !NON_PLATE_PREFIX_WORDS.has(laQue[1])) {
    return laQue[1].replace(/\s+/g, "").toUpperCase();
  }

  const explicit = norm.match(
    new RegExp(`(?:${EMPIEZA_RE}|${COMIENZA_RE})\\s+(?:con\\s+)?([a-z0-9]{2,6})\\b`, "i"),
  );
  if (explicit?.[1] && !NON_PLATE_PREFIX_WORDS.has(explicit[1])) {
    return explicit[1].replace(/\s+/g, "").toUpperCase();
  }

  const conPrefix = norm.match(/\bcon\s+([a-z0-9]{2,6})\b/);
  if (conPrefix?.[1] && !NON_PLATE_PREFIX_WORDS.has(conPrefix[1])) {
    const hint = conPrefix[1].replace(/\s+/g, "").toUpperCase();
    if (!isPlausibleVehiclePlate(hint)) return hint;
  }

  const laPrefix = norm.match(/\b(?:la|el|esa|ese)\s+([a-z]{2,3}\d{0,4})\b/);
  if (laPrefix?.[1]) {
    const hint = laPrefix[1].replace(/\s+/g, "").toUpperCase();
    if (!NON_PLATE_PREFIX_WORDS.has(hint.toLowerCase()) && !isPlausibleVehiclePlate(hint)) return hint;
  }

  const paraPatente = norm.match(/\bpatentes?\b(?:\s+(?:con|de|del|q|que|en))?\s+([a-z0-9]{2,6})\b/i);
  if (paraPatente?.[1] && !NON_PLATE_PREFIX_WORDS.has(paraPatente[1])) {
    return paraPatente[1].replace(/\s+/g, "").toUpperCase();
  }

  const buscarPatentes = norm.match(
    /\b(?:buscame|busca|buscar|mostrame|mostrar|listame|listar|dame|pasame)\b[^.]{0,40}?\bpatentes?\b[^.]{0,20}?\b([a-z0-9]{2,6})\b/,
  );
  if (buscarPatentes?.[1] && !NON_PLATE_PREFIX_WORDS.has(buscarPatentes[1])) {
    return buscarPatentes[1].replace(/\s+/g, "").toUpperCase();
  }

  return extractPlatePrefixAfterFuzzyStartsVerb(norm);
}

/** Fragmento contenido en patente: "las que tengan 815", "contiene AA82". */
export function extractPlateContainsFromMessage(rawText: string | undefined | null): string | null {
  const norm = String(rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!norm) return null;

  const tengan = norm.match(
    /\b(?:tengan|tenga|contienen|contenga|contiene|incluyan|incluye)\s+(?:el|la|los|las)?\s*([a-z0-9]{2,8})\b/,
  );
  if (tengan?.[1] && !NON_PLATE_PREFIX_WORDS.has(tengan[1])) {
    return tengan[1].replace(/\s+/g, "").toUpperCase();
  }

  const queTengan = norm.match(/\bque\s+tengan\s+([a-z0-9]{2,8})\b/);
  if (queTengan?.[1] && !NON_PLATE_PREFIX_WORDS.has(queTengan[1])) {
    return queTengan[1].replace(/\s+/g, "").toUpperCase();
  }

  return null;
}

export function filterUnitsByPlateContains<T extends { patente?: string | null; unidad?: string | null }>(
  units: T[],
  fragment: string,
): T[] {
  const f = fragment.replace(/\s+/g, "").toUpperCase();
  if (f.length < 2) return [];
  return units.filter((u) => {
    const unitPlate = normalizeLoosePlate(u.patente || u.unidad || "");
    return unitPlate.includes(f);
  });
}

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
  if (laQue?.[1] && !NON_PLATE_PREFIX_WORDS.has(laQue[1])) {
    return laQue[1].replace(/\s+/g, "").toUpperCase();
  }

  const explicit = norm.match(/\b(?:termina|finaliza|acaba)\s+(?:con|en)\s+([a-z0-9]{2,6})\b/);
  if (explicit?.[1] && !NON_PLATE_PREFIX_WORDS.has(explicit[1])) {
    return explicit[1].replace(/\s+/g, "").toUpperCase();
  }
  return null;
}

/** Token parcial tipo AA815 (prefijo de patente incompleta). */
export function extractPartialPlateToken(text: string): string | null {
  const stripped = text.trim().replace(/^(la|el|esa|ese)\s+/i, "");
  const compact = stripped.replace(/[\s\-_.]+/g, "").toUpperCase();
  if (detectLoosePlate(text)) return null;
  if (/^\d{1,3}$/.test(compact)) return null;
  if (compact.length < 2 || compact.length > 6) return null;
  if (!/^[A-Z0-9]{2,6}$/.test(compact)) return null;
  if (NON_PLATE_PREFIX_WORDS.has(compact.toLowerCase())) return null;
  if (isPlausibleVehiclePlate(compact)) return compact;
  if (/^[A-Z]{2,3}\d{0,4}$/.test(compact)) return compact;
  return null;
}

export function filterUnitsByPlatePrefix<T extends { patente?: string | null; unidad?: string | null }>(
  units: T[],
  prefix: string,
): T[] {
  const p = prefix.replace(/\s+/g, "").toUpperCase();
  if (p.length < 2) return [];
  return units.filter((u) => {
    const unitPlate = normalizeLoosePlate(u.patente || u.unidad || "");
    return unitPlate.startsWith(p);
  });
}

export function filterUnitsByPlateSuffix<T extends { patente?: string | null; unidad?: string | null }>(
  units: T[],
  suffix: string,
): T[] {
  const s = suffix.replace(/\s+/g, "").toUpperCase();
  if (s.length < 2) return [];
  return units.filter((u) => {
    const unitPlate = normalizeLoosePlate(u.patente || u.unidad || "");
    return unitPlate.endsWith(s);
  });
}

export function extractUnitSearchHint(text: string): {
  kind: "plate" | "prefix" | "suffix" | "partial" | "contains";
  value: string;
} | null {
  const plate = detectLoosePlate(text);
  if (plate) return { kind: "plate", value: plate };
  const prefix = extractPlatePrefixFromMessage(text);
  if (prefix) return { kind: "prefix", value: prefix };
  const suffix = extractPlateSuffixFromMessage(text);
  if (suffix) return { kind: "suffix", value: suffix };
  const contains = extractPlateContainsFromMessage(text);
  if (contains) return { kind: "contains", value: contains };
  const partial = extractPartialPlateToken(text);
  if (partial) return { kind: "partial", value: partial };
  return null;
}
