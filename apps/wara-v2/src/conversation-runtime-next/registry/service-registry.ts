import { CAPABILITY_CATALOG } from "../../commander-v3/capabilities/catalog.js";

export type ServiceDef = {
  id: string;
  capability: string;
  domain: string;
  label: string;
  examples: string[];
  readOnly: boolean;
};

/** Mapeo servicio semántico → capability ejecutable. */
const SERVICE_MAP: ServiceDef[] = [
  {
    id: "company.active",
    capability: "company.get_active",
    domain: "company",
    label: "Empresa activa",
    examples: ["¿cuál es mi empresa?", "empresa activa"],
    readOnly: true,
  },
  {
    id: "company.list",
    capability: "company.list",
    domain: "company",
    label: "Listar empresas",
    examples: ["listar empresas", "cambiar empresa", "otra empresa"],
    readOnly: true,
  },
  {
    id: "company.select",
    capability: "company.select",
    domain: "company",
    label: "Seleccionar empresa",
    examples: ["la primera", "empresa 2", "Transportes SA"],
    readOnly: true,
  },
  {
    id: "unit.search",
    capability: "unit.search",
    domain: "unit",
    label: "Buscar/listar unidades",
    examples: ["listar flota", "buscar patente", "unidades"],
    readOnly: true,
  },
  {
    id: "unit.active",
    capability: "unit.get_active",
    domain: "unit",
    label: "Unidad activa",
    examples: ["¿cuál es la unidad activa?", "unidad actual"],
    readOnly: true,
  },
  {
    id: "unit.previous",
    capability: "unit.get_previous",
    domain: "unit",
    label: "Unidad anterior",
    examples: ["unidad anterior", "la otra unidad"],
    readOnly: true,
  },
  {
    id: "unit.select",
    capability: "unit.select",
    domain: "unit",
    label: "Seleccionar unidad",
    examples: ["la segunda", "patente AA123", "M300-097"],
    readOnly: true,
  },
  {
    id: "gps.status",
    capability: "gps.get_status",
    domain: "gps",
    label: "Estado GPS / ubicación",
    examples: ["ubicación", "gps", "dónde está", "estado de la unidad"],
    readOnly: true,
  },
  {
    id: "certificate.prepare",
    capability: "certificate.prepare",
    domain: "certificate",
    label: "Preparar certificado",
    examples: ["quiero certificado", "certificado de rastreo"],
    readOnly: false,
  },
  {
    id: "certificate.issue",
    capability: "certificate.issue",
    domain: "certificate",
    label: "Emitir certificado",
    examples: ["confirmo certificado"],
    readOnly: false,
  },
  {
    id: "odometer.prepare",
    capability: "odometer.prepare",
    domain: "odometer",
    label: "Preparar odómetro",
    examples: ["actualizar odómetro", "cargar km"],
    readOnly: false,
  },
  {
    id: "odometer.update",
    capability: "odometer.update",
    domain: "odometer",
    label: "Confirmar odómetro",
    examples: ["confirmo odómetro"],
    readOnly: false,
  },
  {
    id: "hourmeter.prepare",
    capability: "hourmeter.prepare",
    domain: "hourmeter",
    label: "Preparar horómetro",
    examples: ["actualizar horómetro", "cargar horas"],
    readOnly: false,
  },
  {
    id: "hourmeter.update",
    capability: "hourmeter.update",
    domain: "hourmeter",
    label: "Confirmar horómetro",
    examples: ["confirmo horómetro"],
    readOnly: false,
  },
  {
    id: "maintenance.prepare",
    capability: "maintenance.prepare",
    domain: "maintenance",
    label: "Preparar mantenimiento",
    examples: ["pedido de mantenimiento", "service"],
    readOnly: false,
  },
  {
    id: "maintenance.create",
    capability: "maintenance.create",
    domain: "maintenance",
    label: "Confirmar mantenimiento",
    examples: ["confirmo mantenimiento"],
    readOnly: false,
  },
  {
    id: "handoff.prepare",
    capability: "handoff.prepare",
    domain: "human_handoff",
    label: "Preparar ticket",
    examples: ["hablar con humano", "abrir ticket"],
    readOnly: false,
  },
  {
    id: "handoff.create",
    capability: "handoff.create",
    domain: "human_handoff",
    label: "Confirmar ticket",
    examples: ["confirmo ticket"],
    readOnly: false,
  },
  {
    id: "domain.answer",
    capability: "domain.answer",
    domain: "domain",
    label: "Consulta general plataforma",
    examples: ["cómo funciona", "qué puedo hacer"],
    readOnly: true,
  },
];

export const SERVICE_REGISTRY: ReadonlyArray<ServiceDef> = SERVICE_MAP;

export function getServiceById(id: string): ServiceDef | undefined {
  return SERVICE_MAP.find((s) => s.id === id);
}

export function capabilityForServiceId(id: string): string | null {
  const s = getServiceById(id);
  return s?.capability ?? null;
}

export function listRegistryForPrompt(): string {
  return SERVICE_MAP.map(
    (s) =>
      `- ${s.id} → ${s.capability} (${s.label}). Ej: ${s.examples.slice(0, 2).join("; ")}`,
  ).join("\n");
}

export function allCapabilityNames(): string[] {
  return CAPABILITY_CATALOG.map((c) => c.name);
}
