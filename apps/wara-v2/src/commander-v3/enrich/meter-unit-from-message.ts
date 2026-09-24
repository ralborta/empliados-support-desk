/**
 * Tras decidir odo/horo/cert: si el mensaje ya trae código/patente y no hay
 * unitReference, rellena la entidad. No elige el trámite (eso ya vino del TurnPlan).
 */
import {
  extractUnitNameCode,
} from "../../pilot/unit-fleet.js";
import {
  isPlausibleVehiclePlate,
  normalizeLoosePlate,
} from "../../pilot/plates.js";
import type { ConversationStateV3 } from "../types/state.js";
import type { TurnPlan } from "../types/turn-plan.js";

function isMeterOrCertPlan(plan: TurnPlan): boolean {
  if (
    plan.task === "odometer" ||
    plan.task === "hourmeter" ||
    plan.task === "certificate"
  ) {
    return true;
  }
  return plan.requestedCapabilities.some(
    (c) =>
      c.name === "odometer.prepare" ||
      c.name === "hourmeter.prepare" ||
      c.name === "certificate.prepare",
  );
}

export function enrichPlanForMeterUnitInMessage(
  plan: TurnPlan,
  state: ConversationStateV3,
  message: string,
): TurnPlan {
  if (!isMeterOrCertPlan(plan)) return plan;

  const t = message.trim();
  if (!t) return plan;

  const code = extractUnitNameCode(t);
  // Si el mensaje trae otra unidad explícita, override aunque ya haya unit activa.
  if (code) {
    const currentDigits = String(state.unit?.name ?? state.unit?.label ?? "")
      .replace(/\D/g, "");
    const codeDigits = code.replace(/\D/g, "");
    const sameAsActive =
      Boolean(state.unit) &&
      codeDigits.length >= 5 &&
      currentDigits.length >= 5 &&
      (currentDigits.includes(codeDigits) || codeDigits.includes(currentDigits));
    if (!plan.unitReference && (!state.unit || !sameAsActive)) {
      return {
        ...plan,
        unitReference: {
          kind: "unit",
          mode: "unit_name",
          value: code,
          reference: null,
        },
        stateIntent: {
          ...plan.stateIntent,
          preserveUnit: false,
        },
        reasoning:
          plan.reasoning ||
          `El mensaje pide la unidad ${code} (override de unidad activa).`,
      };
    }
  }

  if (plan.unitReference || state.unit) return plan;

  const plateNorm = normalizeLoosePlate(t);
  // Solo si el mensaje es casi solo la patente, o la patente está clara en el texto.
  const plateTok = t.match(
    /\b([A-Za-z]{2}\s*\d{3}\s*[A-Za-z]{2}|[A-Za-z]{3}\s*\d{3})\b/,
  );
  const candidate = plateTok?.[1] ? normalizeLoosePlate(plateTok[1]) : plateNorm;
  if (candidate && isPlausibleVehiclePlate(candidate) && candidate.length >= 6) {
    return {
      ...plan,
      unitReference: {
        kind: "unit",
        mode: "plate",
        value: candidate,
        reference: null,
      },
      reasoning:
        plan.reasoning ||
        `El mensaje ya trae la patente ${candidate} para el trámite.`,
    };
  }

  return plan;
}
