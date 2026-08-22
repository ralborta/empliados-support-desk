/**
 * Precedencia compartida: intención explícita estado/GPS gana sobre parse operativo
 * (interno/patente/km) en overlay lateral y router de odómetro/horómetro.
 */
import type { NumericExpectedField } from "@/lib/unitReferenceParser";
import { looksLikeFechaHoraLecturaMessage } from "@/lib/odometroFecha";
import {
  looksLikeBareMeterValue,
  threadAwaitingOdometerKmValue,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerPlate,
  threadAwaitingHorometerPlate,
  threadHasActiveMeterValueRequest,
  extractUnitCodeNumbersFromMessage,
  detectLoosePlate,
  normalizePlate,
  isPlausibleVehiclePlate,
} from "@/lib/wara";
import {
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
} from "@/lib/waraApi";

/** Consulta explícita de estado GPS / unidad (no dato de medidor). */
export function isExplicitUnitStatusQuery(text: string | undefined | null): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  return looksLikeGpsOrUnitStatusQuestion(raw) || looksLikeLiveUnitConsultIntent(raw);
}

/**
 * Intención estado/GPS gana sobre número que parece interno del horómetro/odómetro.
 */
export function statusIntentOverridesMeterOperationalParse(text: string): boolean {
  return isExplicitUnitStatusQuery(text);
}

/**
 * ¿El mensaje es dato operativo del trámite de medidor (unidad, km, fecha)?
 * Usar en overlay lateral, side questions y router — una sola fuente de verdad.
 */
export function isOperationalMeterCollectionMessage(text: string, threadText: string): boolean {
  if (statusIntentOverridesMeterOperationalParse(text)) return false;
  if (looksLikeFechaHoraLecturaMessage(text)) return true;
  if (
    looksLikeBareMeterValue(text) &&
    (threadHasActiveMeterValueRequest(threadText) ||
      threadAwaitingOdometerKmValue(threadText) ||
      threadAwaitingHorometerKmValue(threadText))
  ) {
    return true;
  }
  const compact = text.trim().replace(/\s+/g, "");
  if (/^\d{5,7}$/.test(compact)) return true;
  let expectedField: NumericExpectedField = "none";
  if (threadHasActiveMeterValueRequest(threadText)) expectedField = "meter_value";
  else if (threadAwaitingOdometerPlate(threadText) || threadAwaitingHorometerPlate(threadText)) {
    expectedField = "unit";
  }
  if (extractUnitCodeNumbersFromMessage(text, { expectedField }).length > 0) return true;
  const plate = detectLoosePlate(text);
  if (plate && isPlausibleVehiclePlate(normalizePlate(plate))) return true;
  return false;
}
