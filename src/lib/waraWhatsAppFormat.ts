/**
 * Formato WhatsApp (negrita *…* + emojis) para mensajes operativos de Atilio en prod V1.
 * Portado de apps/wara-v2/src/commander-v3/reply/format-wa.ts — solo presentación.
 */
import type { PendingActionRecord } from "@/lib/pendingAction";
import {
  formatPlateWithSpaces,
  normalizePlate,
  threadAwaitingHorometerKmValue,
  threadAwaitingOdometerKmValue,
  threadHasActiveOdometerFlow,
} from "@/lib/wara";

export function confirmFooter(): string {
  return "➡️ Respondé *CONFIRMO* o *CANCELAR*.";
}

export function formatFleetUnitLabel(plate: string, unitName?: string | null): string {
  const plateRaw = plate?.trim() || "";
  const plateDisp =
    formatPlateWithSpaces(normalizePlate(plateRaw) ?? plateRaw.replace(/\s+/g, "")) ?? plateRaw;
  const nombre = unitName?.trim() || "";
  if (plateDisp && nombre && normalizePlate(plateDisp) !== normalizePlate(nombre)) {
    return `${plateDisp} (${nombre})`;
  }
  return plateDisp || nombre || "la unidad";
}

export function threadIntroducedAtilio(threadText: string): boolean {
  const tail = threadText.slice(-4000).toLowerCase();
  return (
    /hola,\s*soy atilio/.test(tail) ||
    /asistente virtual de wara/.test(tail) ||
    /soy atilio de la mesa de ayuda/.test(tail)
  );
}

export function resolvePendingTaskLabelV1(
  pendingAction: PendingActionRecord | null | undefined,
  threadText?: string,
): string | null {
  if (threadText && threadAwaitingHorometerKmValue(threadText)) return "un horómetro";
  if (pendingAction?.type === "odometro") {
    const meter = pendingAction.payload?.meterType;
    if (meter === "horometro") return "un horómetro";
    return "un odómetro";
  }
  if (pendingAction?.type === "certificados") return "un certificado";
  if (pendingAction?.type === "mantenimiento") return "un mantenimiento";
  if (threadText && threadHasActiveOdometerFlow(threadText)) {
    if (threadAwaitingOdometerKmValue(threadText)) return "un odómetro";
    return "un odómetro";
  }
  return null;
}

export function formatMeterAsk(input: {
  meter: "odometer" | "hourmeter";
  unitLabel: string;
  expected: "value" | "date" | "time" | "datetime";
}): string {
  const isHoro = input.meter === "hourmeter";
  const title = isHoro ? "⏱ *Horómetro*" : "🛣 *Odómetro*";
  const unit = `🚗 Unidad: *${input.unitLabel}*`;
  let ask: string;
  if (input.expected === "value") {
    ask = isHoro
      ? "🔢 Pasame el valor del horómetro en *hs*."
      : "🔢 Pasame el valor del odómetro en *km*.";
  } else if (input.expected === "datetime") {
    ask = "📅 ¿Fecha y hora de la lectura?\n_Ej.: hoy 14:30_";
  } else if (input.expected === "date") {
    ask = "📅 ¿Qué fecha de lectura?\n_Ej.: hoy, 11/08/26_";
  } else {
    ask = "🕐 ¿A qué hora?\n_Ej.: 14:30_";
  }
  return [title, unit, "", ask].join("\n");
}

/** Pedido V1: valor + fecha/hora de lectura en un solo paso. */
export function formatMeterAskWithReading(input: {
  meter: "odometer" | "hourmeter";
  unitLabel: string;
}): string {
  const isHoro = input.meter === "hourmeter";
  const title = isHoro ? "⏱ *Horómetro*" : "🛣 *Odómetro*";
  const unit = `🚗 Unidad: *${input.unitLabel}*`;
  const ask = isHoro
    ? "🔢 Pasame el valor del horómetro en *hs* y la fecha y hora de la lectura.\n_Ej.: 350 hs — 05/08/26 a las 14:30_"
    : "🔢 Pasame el valor del odómetro en *km* y la fecha y hora de la lectura.\n_Ej.: 10500 km — 05/08/26 a las 14:30_";
  return [title, unit, "", ask].join("\n");
}

/** "21/07/2026 10:35" → { dateDisp, time } para formatMeterConfirm. */
export function splitFechaDisplayParts(fechaDisplay: string | null | undefined): {
  dateDisp: string;
  time: string;
} {
  const raw = String(fechaDisplay ?? "").trim();
  if (!raw) return { dateDisp: "", time: "" };
  const space = raw.indexOf(" ");
  if (space === -1) return { dateDisp: raw, time: "" };
  return { dateDisp: raw.slice(0, space), time: raw.slice(space + 1).trim() };
}

export function formatMeterConfirm(input: {
  meter: "odometer" | "hourmeter";
  unitLabel: string;
  value: string | number;
  dateDisp: string;
  time: string;
}): string {
  const isHoro = input.meter === "hourmeter";
  const title = isHoro ? "⏱ *Confirmar horómetro*" : "🛣 *Confirmar odómetro*";
  const unitSuffix = isHoro ? "hs" : "km";
  return [
    title,
    `🚗 Unidad: *${input.unitLabel}*`,
    `🔢 Valor: *${input.value}* ${unitSuffix}`,
    `📅 Fecha: *${input.dateDisp}*`,
    `🕐 Hora: *${input.time}*`,
    "",
    "¿Confirmás el registro?",
    confirmFooter(),
  ].join("\n");
}

export function formatGreeting(input: {
  introduced: boolean;
  companyName?: string | null;
  pendingTaskLabel?: string | null;
  companyListBlock?: string | null;
}): string {
  const intro = !input.introduced
    ? "👋 *Hola, soy Atilio*\nAsistente virtual de WARA."
    : "👋 *Hola*";

  if (input.companyListBlock) {
    return [
      intro,
      "",
      "🏢 Antes de seguir, elegí la empresa:",
      input.companyListBlock,
    ].join("\n");
  }

  const body: string[] = [intro];
  if (input.companyName) {
    body.push(`🏢 Seguimos con *${input.companyName}*.`);
  }
  if (input.pendingTaskLabel) {
    body.push(`📌 Tenemos pendiente ${input.pendingTaskLabel}.`);
  }
  body.push(
    "",
    "¿En qué te ayudo?",
    "• 🛣 Odómetro / ⏱ horómetro",
    "• 📋 Certificado",
    "• 📍 GPS / reporte",
    "• 🔧 Mantenimiento",
  );
  return body.join("\n");
}

export function formatAskUnit(
  kind: "odometer" | "hourmeter" | "certificate" | "maintenance" | "gps",
): string {
  const title =
    kind === "hourmeter"
      ? "⏱ *Horómetro*"
      : kind === "certificate"
        ? "📋 *Certificado*"
        : kind === "maintenance"
          ? "🔧 *Mantenimiento*"
          : kind === "gps"
            ? "📍 *Estado de la unidad*"
            : "🛣 *Odómetro*";
  return [
    title,
    "",
    "¿De qué unidad? Pasame la *patente* o el código (ej. M900-071).",
  ].join("\n");
}

export function formatSoftClose(kind: "thanks" | "bye" | "ack"): string {
  if (kind === "thanks") return "🙏 De nada. Cualquier cosa avisame.";
  if (kind === "bye") return "👋 ¡Chau! Cualquier cosa avisame.";
  return "👍 Dale, cualquier cosa avisame.";
}

export function formatContinueConsult(input: {
  companyName?: string | null;
  unitLabel?: string | null;
}): string {
  const lines: string[] = ["Dale, seguimos."];
  if (input.companyName) {
    lines.push(`🏢 Empresa: *${input.companyName}*`);
  }
  if (input.unitLabel) {
    lines.push(`🚗 Unidad: *${input.unitLabel}*`);
  }
  lines.push(
    "",
    "¿En qué te ayudo?",
    "• 🛣 Odómetro / ⏱ horómetro",
    "• 📋 Certificado",
    "• 📍 GPS / reporte",
    "• 🔧 Mantenimiento",
    "• 👨‍💼 Hablar con un asesor",
  );
  return lines.join("\n");
}

export function buildAtilioStructuredGreeting(input: {
  threadText: string;
  companyName?: string | null;
  companyListBlock?: string | null;
  pendingAction?: PendingActionRecord | null;
  repeatGreeting?: boolean;
}): string {
  const introduced =
    threadIntroducedAtilio(input.threadText) || input.repeatGreeting === true;
  return formatGreeting({
    introduced,
    companyName: input.companyListBlock ? null : input.companyName ?? null,
    pendingTaskLabel: resolvePendingTaskLabelV1(input.pendingAction, input.threadText),
    companyListBlock: input.companyListBlock ?? null,
  });
}
