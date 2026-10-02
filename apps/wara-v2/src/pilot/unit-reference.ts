/** Detecta referencia explícita a unidad/patente/nombre en el mensaje actual. */
import { detectLoosePlate } from "./plates.js";
import { extractSearchToken, extractUnitNameCode } from "./unit-fleet.js";
import { extractUnitSearchHint, isBarePlatePrefixHint } from "./plate-prefix.js";
import { looksLikeGpsReportRequest } from "./brief-replies.js";

export function hasExplicitUnitReference(text: string): boolean {
  if (detectLoosePlate(text)) return true;
  if (extractUnitNameCode(text)) return true;
  if (extractUnitSearchHint(text)) return true;
  if (isBarePlatePrefixHint(text)) return true;
  const token = extractExplicitUnitToken(text);
  return token != null;
}

/** Token de unidad extraído del mensaje (sin usar unidad activa). */
export function extractExplicitUnitToken(text: string): string | null {
  const plate = detectLoosePlate(text);
  if (plate) return plate;
  const code = extractUnitNameCode(text);
  if (code) return code;
  const token = extractSearchToken(text);
  if (!token) return null;
  if (looksLikeGpsReportRequest(text)) return token;
  if (token.length >= 2 && token.length <= 40) return token;
  return null;
}
