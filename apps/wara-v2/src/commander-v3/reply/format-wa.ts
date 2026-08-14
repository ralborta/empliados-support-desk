/**
 * Formato WhatsApp (negrita *…* + iconos) para hechos operativos V3.
 * Solo presentación: no cambia semántica ni contratos de escritura.
 */

export function confirmFooter(): string {
  return "➡️ Respondé *CONFIRMO* o *CANCELAR*.";
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

export function formatMeterFutureDate(dateDisp: string): string {
  return [
    "⚠️ *Fecha futura*",
    `📅 *${dateDisp}* todavía no llegó.`,
    "",
    "Pasame una fecha de lectura de *hoy* o anterior.",
    "_Ej.: hoy, 11/08/26_",
  ].join("\n");
}

export function formatMeterAnomaly(question: string): string {
  return ["⚠️ *Revisión de valor*", question, "", confirmFooter()].join("\n");
}

export function formatCertificateConfirm(input: {
  unitLabel: string;
  companyName?: string | null;
}): string {
  const lines = [
    "📋 *Certificado de cobertura*",
    `🚗 Unidad: *${input.unitLabel}*`,
  ];
  if (input.companyName) {
    lines.push(`🏢 Empresa: *${input.companyName}*`);
  }
  lines.push("", "¿Confirmás la emisión?", confirmFooter());
  return lines.join("\n");
}

export function formatMaintenanceAskDetail(unitLabel?: string | null): string {
  const lines = ["🔧 *Mantenimiento*"];
  if (unitLabel) lines.push(`🚗 Unidad: *${unitLabel}*`);
  lines.push("", "✍️ Contame el detalle del mantenimiento que necesitás.");
  return lines.join("\n");
}

export function formatMaintenanceConfirm(input: {
  unitLabel: string;
  kindLabel: string;
  priority: string;
  detail: string;
}): string {
  return [
    "🔧 *Confirmar mantenimiento*",
    `🚗 Unidad: *${input.unitLabel}*`,
    `🏷 Tipo: *${input.kindLabel}*`,
    `⚡ Prioridad: *${input.priority}*`,
    `📝 Detalle: ${input.detail}`,
    "",
    "¿Confirmás el pedido?",
    confirmFooter(),
  ].join("\n");
}

export function formatHandoffAskDetail(): string {
  return [
    "👨‍💼 *Derivación a asesor*",
    "",
    "✍️ Contame el motivo para derivarte.",
  ].join("\n");
}

export function formatHandoffConfirm(input: {
  categoryLabel: string;
  detail: string;
  strict?: boolean;
}): string {
  const lines = [
    "👨‍💼 *Confirmar ticket*",
    `🏷 Categoría: *${input.categoryLabel}*`,
    `📝 Motivo: ${input.detail}`,
    "",
    "¿Confirmás generar el ticket?",
    confirmFooter(),
  ];
  if (input.strict) {
    lines.push("_(No alcanza con gracias/chau.)_");
  }
  return lines.join("\n");
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

  if (input.companyName && !input.introduced) {
    // primera vez + una sola empresa
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

export function formatCompanyActive(name: string): string {
  return `🏢 Empresa activa: *${name}*.`;
}

export function formatCompanyList(lines: string): string {
  return [
    "🏢 *Elegí la empresa*",
    "Todavía no hay empresa activa:",
    lines,
  ].join("\n");
}

export function formatUnitActive(label: string): string {
  return `🚗 Unidad activa: *${label}*.`;
}

export function formatUnitMenu(label: string): string {
  return [
    `🚗 Unidad: *${label}*`,
    "",
    "¿En qué te ayudo con esta unidad?",
    "• 📍 Estado / reporte GPS",
    "• 🛣 Odómetro / ⏱ horómetro",
    "• 📋 Certificado",
  ].join("\n");
}

export function formatGpsReport(report: string): string {
  // buildGpsLabSummary ya trae encabezado con iconos.
  if (/^📍/.test(report.trim()) || /^✅/.test(report.trim()) || /^⏸/.test(report.trim()) || /^⚠️/.test(report.trim())) {
    return report;
  }
  return `📍 *Reporte GPS*\n\n${report}`;
}

export function formatSoftClose(kind: "thanks" | "bye" | "ack"): string {
  if (kind === "thanks") return "🙏 De nada. Cualquier cosa avisame.";
  if (kind === "bye") return "👋 ¡Chau! Cualquier cosa avisame.";
  return "👍 Dale, cualquier cosa avisame.";
}

export function formatSuccessMeter(input: {
  meterLabel: string;
  value: string | number;
  unitLabel?: string | null;
  dateDisp: string;
  time: string;
}): string {
  const unit = input.unitLabel ? ` en *${input.unitLabel}*` : "";
  return [
    `✅ *${input.meterLabel} registrado*`,
    `🔢 *${input.value}*${unit}`,
    `📅 ${input.dateDisp} · 🕐 ${input.time}`,
  ].join("\n");
}

export function formatSuccessCertificate(input: {
  unitLabel?: string | null;
  url?: string | null;
  simulated?: boolean;
}): string {
  const unit = input.unitLabel ? ` para *${input.unitLabel}*` : "";
  if (input.simulated) {
    return `✅ *Certificado* (simulado)${unit}.\n_Sin emisión real en lab._`;
  }
  const urlBit = input.url ? `\n🔗 ${input.url}` : "";
  return `✅ *Certificado emitido*${unit}.${urlBit}`;
}

export function formatSuccessTicket(ref: string): string {
  return [
    "✅ *Ticket generado*",
    `🎫 Ref: *${ref}*`,
    "Un asesor te va a contactar por este medio.",
  ].join("\n");
}
