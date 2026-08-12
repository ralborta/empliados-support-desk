/**
 * Umbrales de valor anómalo para odómetro/horómetro (confirmación reforzada).
 */
import type { MeterType } from "../odometer-types.js";

export type AnomalyThresholds = {
  odometerAbsDelta: number;
  horometerAbsDelta: number;
  odometerRelRatio: number;
  horometerRelRatio: number;
};

const DEFAULTS: AnomalyThresholds = {
  odometerAbsDelta: 50_000,
  horometerAbsDelta: 2_000,
  odometerRelRatio: 0.5,
  horometerRelRatio: 1.0,
};

export function getAnomalyThresholds(env: NodeJS.ProcessEnv = process.env): AnomalyThresholds {
  return {
    odometerAbsDelta: Number(env.WARA_V2_ODOMETER_ANOMALY_DELTA ?? DEFAULTS.odometerAbsDelta),
    horometerAbsDelta: Number(env.WARA_V2_HOROMETER_ANOMALY_DELTA ?? DEFAULTS.horometerAbsDelta),
    odometerRelRatio: Number(env.WARA_V2_ODOMETER_ANOMALY_RATIO ?? DEFAULTS.odometerRelRatio),
    horometerRelRatio: Number(env.WARA_V2_HOROMETER_ANOMALY_RATIO ?? DEFAULTS.horometerRelRatio),
  };
}

export function isAnomalousReading(input: {
  valueNew: number;
  valuePrevious: number | null;
  meterType: MeterType;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const { valueNew, valuePrevious, meterType } = input;
  if (valuePrevious == null || !Number.isFinite(valueNew) || !Number.isFinite(valuePrevious)) {
    return false;
  }
  const delta = valueNew - valuePrevious;
  if (delta <= 0) return false;
  const t = getAnomalyThresholds(input.env);
  if (meterType === "horometro") {
    return delta >= t.horometerAbsDelta || delta >= valuePrevious * t.horometerRelRatio;
  }
  return delta >= t.odometerAbsDelta || delta >= valuePrevious * t.odometerRelRatio;
}

export function formatAnomalyQuestion(valueNew: number, meterType: MeterType): string {
  const unit = meterType === "horometro" ? "hs" : "km";
  const label = meterType === "horometro" ? "horómetro" : "odómetro";
  const formatted = valueNew.toLocaleString("es-AR");
  return `El valor ${formatted} ${unit} es muy superior al actual registrado. ¿Confirmás que no hay un error de digitación?`;
  void label;
}

export function looksLikeAnomalyAck(text: string): boolean {
  const n = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (/^(si|sí|confirmo|dale|ok|okay|correcto)[!?.]*$/.test(n)) return true;
  return /\b(confirm|no\s+hay\s+error|esta\s+bien|está\s+bien|es\s+correcto|sin\s+error)\b/.test(n);
}

export function looksLikeAnomalyReject(text: string): boolean {
  const n = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (/^(no|nop|nah)[!?.]*$/.test(n)) return true;
  return /\b(me\s+equivoqu|error\s+de\s+digitacion|mal\s+el\s+valor|corregir\s+el\s+valor)\b/.test(n);
}
