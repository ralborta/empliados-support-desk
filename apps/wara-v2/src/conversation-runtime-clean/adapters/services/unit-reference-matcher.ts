import type { EntityReference, UnitReferenceKind } from "../../core/types/interpretation.js";
import type { UnitState } from "../../core/types/state.js";

function canonical(value: string): string {
  let result = "";
  for (const character of value.normalize("NFD").toUpperCase()) {
    const code = character.codePointAt(0) ?? 0;
    const asciiLetter = code >= 65 && code <= 90;
    const digit = code >= 48 && code <= 57;
    if (asciiLetter || digit) result += character;
  }
  return result;
}

function canonicalInternalCode(value: string): string {
  const normalized = canonical(value);
  return normalized.startsWith("M") && normalized.length > 1 && normalized.charCodeAt(1) >= 48 && normalized.charCodeAt(1) <= 57
    ? normalized.slice(1)
    : normalized;
}

function field(unit: UnitState, kind: UnitReferenceKind): readonly string[] {
  if (kind === "internal_code") return [unit.id, unit.code ?? "", unit.label];
  if (kind === "plate") return [unit.plate ?? ""];
  if (kind === "name") return [unit.label];
  if (kind === "brand") return [unit.brand ?? ""];
  if (kind === "model") return [unit.model ?? ""];
  return [unit.id, unit.code ?? "", unit.plate ?? "", unit.label, unit.brand ?? "", unit.model ?? ""];
}

function exactMatch(unit: UnitState, expression: string, kind: UnitReferenceKind): boolean {
  const query = kind === "internal_code" ? canonicalInternalCode(expression) : canonical(expression);
  if (!query) return false;
  return field(unit, kind).some((value) => (kind === "internal_code" ? canonicalInternalCode(value) : canonical(value)) === query);
}

function partialMatch(unit: UnitState, expression: string, kind: UnitReferenceKind): boolean {
  if (kind === "internal_code" || kind === "plate") return false;
  const query = canonical(expression);
  if (query.length < 2) return false;
  return field(unit, kind).some((value) => canonical(value).includes(query));
}

export function matchUnitsByReference(units: readonly UnitState[], reference: EntityReference): readonly UnitState[] {
  const kind = reference.unitReferenceKind ?? "any";
  const exact = units.filter((unit) => exactMatch(unit, reference.expression, kind));
  if (exact.length) return exact;
  return units.filter((unit) => partialMatch(unit, reference.expression, kind));
}

export const unitReferenceNormalization = Object.freeze({ canonical, canonicalInternalCode });
