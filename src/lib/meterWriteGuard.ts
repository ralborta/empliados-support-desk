/**
 * Guardas de escritura odómetro/horómetro (Ola 1).
 * Nunca autoriza: solo bloquea valores dudosos antes de llamar a Visionblo/Wara.
 */

export type MeterKind = "odometro" | "horometro";

export type MeterWriteAssessment =
  | {
      ok: true;
      kind: MeterKind;
      odometro?: number;
      horometro?: number;
    }
  | {
      ok: false;
      code:
        | "missing_value"
        | "non_finite"
        | "non_positive"
        | "ambiguous_both"
        | "kind_mismatch"
        | "out_of_range";
      clientMessage: string;
    };

const MAX_ODOMETRO_KM = 50_000_000;
const MAX_HOROMETRO_HS = 1_000_000;

function finiteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Valida el payload de registro. Si hay ambigüedad o valor inválido → no escribir.
 */
export function assessMeterWrite(input: {
  meterKind: MeterKind | null | undefined;
  odometro?: number | null;
  horometro?: number | null;
}): MeterWriteAssessment {
  const hasOdo = finiteNumber(input.odometro);
  const hasHoro = finiteNumber(input.horometro);
  const odometro = hasOdo ? input.odometro : undefined;
  const horometro = hasHoro ? input.horometro : undefined;

  if (!hasOdo && !hasHoro) {
    return {
      ok: false,
      code: "missing_value",
      clientMessage:
        "No pude registrar: me falta el valor de odómetro (km) o de horómetro (horas). ¿Me lo pasás de nuevo?",
    };
  }

  if (hasOdo && odometro! <= 0) {
    return {
      ok: false,
      code: "non_positive",
      clientMessage:
        "El odómetro tiene que ser un número mayor a 0 (en km). Revisá el valor y mandámelo de nuevo.",
    };
  }
  if (hasHoro && horometro! <= 0) {
    return {
      ok: false,
      code: "non_positive",
      clientMessage:
        "El horómetro tiene que ser un número mayor a 0 (en horas). Revisá el valor y mandámelo de nuevo.",
    };
  }

  if (hasOdo && (odometro! > MAX_ODOMETRO_KM || !Number.isFinite(odometro!))) {
    return {
      ok: false,
      code: "out_of_range",
      clientMessage:
        "Ese kilometraje no me cierra. Pasame el odómetro en km otra vez (sin puntos de miles si se puede).",
    };
  }
  if (hasHoro && (horometro! > MAX_HOROMETRO_HS || !Number.isFinite(horometro!))) {
    return {
      ok: false,
      code: "out_of_range",
      clientMessage:
        "Ese valor de horas no me cierra. Pasame el horómetro en horas de motor otra vez.",
    };
  }

  const kind = input.meterKind ?? null;

  if (hasOdo && hasHoro) {
    if (kind === "odometro") {
      return { ok: true, kind: "odometro", odometro: odometro! };
    }
    if (kind === "horometro") {
      return { ok: true, kind: "horometro", horometro: horometro! };
    }
    return {
      ok: false,
      code: "ambiguous_both",
      clientMessage:
        "Tengo km y horas a la vez y no quiero registrar mal. ¿Es cambio de *odómetro* (km) o de *horómetro* (horas)?",
    };
  }

  if (kind === "odometro" && !hasOdo) {
    return {
      ok: false,
      code: "kind_mismatch",
      clientMessage:
        "Estamos con odómetro (km) y el valor no me quedó claro. Pasame solo el kilometraje.",
    };
  }
  if (kind === "horometro" && !hasHoro) {
    return {
      ok: false,
      code: "kind_mismatch",
      clientMessage:
        "Estamos con horómetro (horas) y el valor no me quedó claro. Pasame solo las horas de motor.",
    };
  }

  if (hasOdo) return { ok: true, kind: "odometro", odometro: odometro! };
  return { ok: true, kind: "horometro", horometro: horometro! };
}

/** Post-escritura: Wara devolvió negativo → señalamos anomalía (no reescribimos). */
export function meterResultLooksCorrupt(result: {
  odometro?: { valor_nuevo_km?: number | null } | null;
  horometro?: { valor_nuevo_horas?: number | null } | null;
}): boolean {
  const o = result.odometro?.valor_nuevo_km;
  const h = result.horometro?.valor_nuevo_horas;
  if (typeof o === "number" && Number.isFinite(o) && o < 0) return true;
  if (typeof h === "number" && Number.isFinite(h) && h < 0) return true;
  return false;
}
