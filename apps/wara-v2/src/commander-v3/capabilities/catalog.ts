/** Catálogo de capabilities — el LLM elige; el ejecutor no decide intención. */

export type CapabilityDef = {
  name: string;
  purpose: string;
  params: string[];
  kind: "read" | "write_prepare" | "write_commit" | "domain";
  requiredFields: string[];
  requiresConfirmation: boolean;
  returnsFacts: string[];
  errors: string[];
};

export const CAPABILITY_CATALOG: CapabilityDef[] = [
  {
    name: "company.get_active",
    purpose: "Informar empresa activa",
    params: [],
    kind: "read",
    requiredFields: [],
    requiresConfirmation: false,
    returnsFacts: ["companyName"],
    errors: ["no_company"],
  },
  {
    name: "company.list",
    purpose: "Listar empresas disponibles",
    params: [],
    kind: "read",
    requiredFields: [],
    requiresConfirmation: false,
    returnsFacts: ["companies"],
    errors: ["no_contacts"],
  },
  {
    name: "company.select",
    purpose: "Seleccionar empresa por id/índice/nombre ya resuelto",
    params: ["companyId", "index"],
    kind: "read",
    requiredFields: [],
    requiresConfirmation: false,
    returnsFacts: ["companyName"],
    errors: ["not_found", "ambiguous"],
  },
  {
    name: "unit.search",
    purpose:
      "Buscar unidades o listar flota completa (lista/la lista/lista porfa/listado → sin query)",
    params: ["query", "mode"],
    kind: "read",
    requiredFields: ["company"],
    requiresConfirmation: false,
    returnsFacts: ["listing"],
    errors: ["no_fleet", "not_found"],
  },
  {
    name: "unit.select",
    purpose: "Fijar unidad activa desde resolución estructurada",
    params: ["movilId", "index"],
    kind: "read",
    requiredFields: [],
    requiresConfirmation: false,
    returnsFacts: ["unitLabel"],
    errors: ["not_found"],
  },
  {
    name: "unit.get_active",
    purpose: "Informar unidad activa",
    params: [],
    kind: "read",
    requiredFields: [],
    requiresConfirmation: false,
    returnsFacts: ["unitLabel"],
    errors: ["no_unit"],
  },
  {
    name: "unit.get_previous",
    purpose: "Informar unidad anterior",
    params: [],
    kind: "read",
    requiredFields: [],
    requiresConfirmation: false,
    returnsFacts: ["previousUnitLabel"],
    errors: ["no_previous"],
  },
  {
    name: "gps.get_status",
    purpose: "Lectura GPS de unidad activa o referida",
    params: ["movilId"],
    kind: "read",
    requiredFields: ["unit"],
    requiresConfirmation: false,
    returnsFacts: ["gpsReport"],
    errors: ["no_unit", "no_data"],
  },
  {
    name: "certificate.prepare",
    purpose: "Preparar certificado (pendingWrite)",
    params: ["movilId"],
    kind: "write_prepare",
    requiredFields: ["unit"],
    requiresConfirmation: true,
    returnsFacts: ["confirmQuestion", "operationId"],
    errors: ["no_unit", "gate_off"],
  },
  {
    name: "certificate.issue",
    purpose: "Emitir certificado tras confirmación inequívoca",
    params: ["operationId", "version", "payloadHash"],
    kind: "write_commit",
    requiredFields: ["pendingWrite"],
    requiresConfirmation: true,
    returnsFacts: ["simulatedOrRealResult"],
    errors: ["mismatch", "gate_off", "veto"],
  },
  {
    name: "odometer.prepare",
    purpose: "Preparar update odómetro",
    params: ["value", "date", "time", "movilId"],
    kind: "write_prepare",
    requiredFields: ["unit", "value", "date", "time"],
    requiresConfirmation: true,
    returnsFacts: ["confirmQuestion", "operationId"],
    errors: ["missing_fields", "anomaly", "gate_off"],
  },
  {
    name: "odometer.update",
    purpose: "Commit odómetro tras confirm",
    params: ["operationId", "version", "payloadHash"],
    kind: "write_commit",
    requiredFields: ["pendingWrite"],
    requiresConfirmation: true,
    returnsFacts: ["simulatedOrRealResult"],
    errors: ["mismatch", "gate_off", "veto"],
  },
  {
    name: "hourmeter.prepare",
    purpose: "Preparar update horómetro",
    params: ["value", "date", "time", "movilId"],
    kind: "write_prepare",
    requiredFields: ["unit", "value", "date", "time"],
    requiresConfirmation: true,
    returnsFacts: ["confirmQuestion", "operationId"],
    errors: ["missing_fields", "anomaly", "gate_off"],
  },
  {
    name: "hourmeter.update",
    purpose: "Commit horómetro tras confirm",
    params: ["operationId", "version", "payloadHash"],
    kind: "write_commit",
    requiredFields: ["pendingWrite"],
    requiresConfirmation: true,
    returnsFacts: ["simulatedOrRealResult"],
    errors: ["mismatch", "gate_off", "veto"],
  },
  {
    name: "maintenance.prepare",
    purpose: "Preparar pedido de mantenimiento",
    params: ["detail", "priority", "movilId"],
    kind: "write_prepare",
    requiredFields: ["unit", "detail"],
    requiresConfirmation: true,
    returnsFacts: ["confirmQuestion", "operationId"],
    errors: ["missing_fields", "gate_off"],
  },
  {
    name: "maintenance.create",
    purpose: "Commit mantenimiento tras confirm",
    params: ["operationId", "version", "payloadHash"],
    kind: "write_commit",
    requiredFields: ["pendingWrite"],
    requiresConfirmation: true,
    returnsFacts: ["simulatedOrRealResult"],
    errors: ["mismatch", "gate_off", "veto"],
  },
  {
    name: "handoff.prepare",
    purpose: "Preparar ticket / derivación humana",
    params: ["detail", "movilId"],
    kind: "write_prepare",
    requiredFields: ["detail"],
    requiresConfirmation: true,
    returnsFacts: ["confirmQuestion", "operationId"],
    errors: ["missing_fields", "gate_off"],
  },
  {
    name: "handoff.create",
    purpose: "Crear ticket tras confirm inequívoca",
    params: ["operationId", "version", "payloadHash"],
    kind: "write_commit",
    requiredFields: ["pendingWrite"],
    requiresConfirmation: true,
    returnsFacts: ["simulatedOrRealResult"],
    errors: ["mismatch", "gate_off", "veto"],
  },
  {
    name: "domain.answer",
    purpose:
      "Guía panel o concepto WARA (topic: platform_opciones|platform_unidades|platform_mantenimiento|odometer|horometer|gps|certificate|wara). Configuración/agenda/notificaciones/perfiles → platform_opciones; chevron/historial → platform_unidades.",
    params: ["topic"],
    kind: "domain",
    requiredFields: [],
    requiresConfirmation: false,
    returnsFacts: ["domainAnswer"],
    errors: ["unknown_topic"],
  },
];

export function capabilityNames(): string[] {
  return CAPABILITY_CATALOG.map((c) => c.name);
}

export function getCapability(name: string): CapabilityDef | undefined {
  return CAPABILITY_CATALOG.find((c) => c.name === name);
}

export function catalogForPrompt(): string {
  return CAPABILITY_CATALOG.map(
    (c) =>
      `- ${c.name} (${c.kind}${c.requiresConfirmation ? ", confirm" : ""}): ${c.purpose}`,
  ).join("\n");
}
