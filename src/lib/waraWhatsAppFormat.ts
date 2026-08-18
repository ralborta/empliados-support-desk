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

/** Plantillas con emoji de servicio — no pasar por IA (preserva iconos y negritas). */
export function isStructuredWhatsAppTemplate(text: string | undefined | null): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return /^[📍🛣⏱📋🔧👋🚗🔢📅🕐📌🏢🙏👍⚡🛠📝]/.test(t);
}

export type FleetListUnitRow = {
  patente?: string | null;
  unidad?: string | null;
  marca?: string | null;
};

export const FLEET_LIST_PAGE_SIZE = 25;

function fleetListSortKey(unit: FleetListUnitRow): string {
  return `${String(unit.unidad ?? "").trim()}|${String(unit.patente ?? "").trim()}`.toUpperCase();
}

function formatFleetListPlate(plate: string | null | undefined): string {
  const raw = String(plate ?? "").trim();
  if (!raw) return "s/ patente";
  return formatPlateWithSpaces(normalizePlate(raw) ?? raw.replace(/\s+/g, "")) ?? raw;
}

/** Offset de la próxima página según el último “te muestro 1–25” del hilo. */
export function nextFleetListOffset(threadText: string, pageSize = FLEET_LIST_PAGE_SIZE): number {
  const matches = [...String(threadText ?? "").matchAll(/te muestro \*?(\d+)\s*[–-]\s*(\d+)\*?/gi)];
  const last = matches.at(-1);
  if (!last) return 0;
  const end = Number(last[2]);
  if (!Number.isFinite(end) || end <= 0) return 0;
  return end;
}

export function looksLikeMoreFleetListRequest(text: string | undefined | null): boolean {
  const t = String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(mas|mas)\s+(unidades|opciones|lista|camiones)|otras unidades|resto de la lista|el resto de la lista\b/.test(
    t,
  );
}

/** Listado WhatsApp: patente, nro de unidad y marca, ordenado, paginado. */
export function formatFleetListWhatsApp(input: {
  companyName: string;
  units: FleetListUnitRow[];
  offset?: number;
  pageSize?: number;
  matchHint?: string | null;
}): string {
  const pageSize = input.pageSize ?? FLEET_LIST_PAGE_SIZE;
  const offset = Math.max(0, input.offset ?? 0);
  const sorted = [...input.units].sort((a, b) =>
    fleetListSortKey(a).localeCompare(fleetListSortKey(b), "es", { numeric: true }),
  );
  const total = sorted.length;
  if (total === 0) {
    return [
      "📋 *Listado de unidades*",
      `🏢 *${input.companyName}*`,
      "",
      "No encontré unidades en esta empresa.",
    ].join("\n");
  }
  const start = Math.min(offset, total);
  const slice = sorted.slice(start, start + pageSize);
  const from = start + 1;
  const to = start + slice.length;
  const hint = input.matchHint?.trim();
  const lines = slice.map((unit, i) => {
    const n = start + i + 1;
    const plate = formatFleetListPlate(unit.patente);
    const nro = String(unit.unidad ?? "").trim() || "s/ nro";
    const marca = String(unit.marca ?? "").trim() || "s/ marca";
    return `${n}. 🚗 *${plate}* · 🔢 *${nro}* · 🏭 ${marca}`;
  });
  const header = [
    "📋 *Listado de unidades*",
    `🏢 *${input.companyName}*`,
    hint
      ? `🚗 *${total}* coinciden con *${hint}* — te muestro *${from}–${to}*, ordenadas por nro.`
      : `🚗 *${total}* unidades — te muestro *${from}–${to}*, ordenadas por nro.`,
    "",
  ];
  const footer =
    to < total
      ? [
          "",
          `➡️ Quedan *${total - to}*. Escribí *más unidades* para seguir, o una patente / marca para buscar.`,
        ]
      : ["", "➡️ Si querés el estado de una, pasame la patente o el nro."];
  return [...header, ...lines, ...footer].join("\n");
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

/** Tras tomar valor parcial: falta fecha/hora, solo hora, o valor+fecha completos. */
export function formatMeterPartialAck(input: {
  meter: "odometer" | "hourmeter";
  unitLabel: string;
  value?: number;
  missing: "datetime" | "time" | "value_and_datetime";
  dateDisp?: string;
}): string {
  const isHoro = input.meter === "hourmeter";
  const title = isHoro ? "⏱ *Horómetro*" : "🛣 *Odómetro*";
  const lines = [title, `🚗 Unidad: *${input.unitLabel}*`, ""];
  if (typeof input.value === "number") {
    lines.push(`🔢 Valor: *${input.value}* ${isHoro ? "hs" : "km"}`, "");
  }
  if (input.missing === "time" && input.dateDisp) {
    lines.push(`📅 Fecha: *${input.dateDisp}*`, "", "🕐 ¿A qué hora fue la lectura?", "_Ej.: 14:30_");
  } else if (input.missing === "datetime") {
    lines.push(
      "📅 Me falta la *fecha y hora* de la lectura.",
      "_Ej.: 05/08/26 a las 14:30_",
    );
  } else {
    lines.push(
      isHoro
        ? "🔢 Pasame el valor del horómetro en *hs* y la fecha y hora de la lectura."
        : "🔢 Pasame el valor del odómetro en *km* y la fecha y hora de la lectura.",
      "_Ej.: 10500 km — 05/08/26 a las 14:30_",
    );
  }
  return lines.join("\n");
}

export function formatCertificateConfirm(input: {
  unitLabel: string;
  companyName: string;
}): string {
  return [
    "📋 *Confirmar certificado*",
    `🚗 Unidad: *${input.unitLabel}*`,
    `🏢 Empresa: *${input.companyName}*`,
    "",
    "¿Confirmás la solicitud a WARA?",
    confirmFooter(),
  ].join("\n");
}

export function formatCertificateAlreadySent(input: {
  unitLabel: string;
  rateLimited?: boolean;
}): string {
  const tail = input.rateLimited
    ? 'Si seguís sin recibirlo, escribí *"hablar con un asesor"*.'
    : "Si necesitás que lo reenvíe, pedímelo explícitamente.";
  return [
    "📋 *Certificado de cobertura*",
    `🚗 Unidad: *${input.unitLabel}*`,
    "",
    "✅ Ya fue enviado.",
    tail,
  ].join("\n");
}

export function formatMaintenanceConfirm(input: {
  unitLabel: string;
  service: string;
  priorityLabel: string;
  detalle: string;
}): string {
  return [
    "🔧 *Confirmar mantenimiento*",
    `🚗 Unidad: *${input.unitLabel}*`,
    `🛠 Tipo: *${input.service}*`,
    `⚡ Prioridad: *${input.priorityLabel}*`,
    `📝 Detalle: *${input.detalle}*`,
    "",
    "¿Confirmás el registro?",
    confirmFooter(),
  ].join("\n");
}

export function formatPendingConfirmReminder(): string {
  return [
    "📌 *Confirmación pendiente*",
    "",
    "Respondé *CONFIRMO* para registrar.",
    "Si algo no está bien, decime la patente o el valor correcto.",
    "También podés escribir *CANCELAR* o pedir otra gestión.",
  ].join("\n");
}

export function formatCompanySelected(companyName: string): string {
  let name = companyName.trim();
  if (!name) return "👋 Perfecto. ¿En qué te puedo ayudar?";
  name = name.replace(/\.\.+\s*$/, ".").trim();
  const trailingDot = name.endsWith(".") ? "" : ".";
  return [`🏢 Perfecto, sigo con *${name}*${trailingDot}`, "", "¿En qué te puedo ayudar?"].join("\n");
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

export function buildBriefServiceScopeConsultationReply(): string {
  return [
    "Sí, podés consultarme por acá.",
    "",
    "Atiendo *GPS/reporte*, *odómetro/horómetro*, *certificados*, *mantenimiento* y *guías de Wara*.",
    "¿Sobre cuál?",
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
    "¿De qué unidad? Pasame la *patente* o el código (ej. M300-097, 600088).",
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
