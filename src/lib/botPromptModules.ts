export type BotPromptModuleDef = {
  key: string;
  name: string;
  description: string;
  flowLabel: string;
  sortOrder: number;
  /** Archivo en scripts/ usado como semilla y respaldo al guardar */
  defaultFile?: string;
  builderbotFlowId?: string;
  builderbotAnswerId?: string;
  /** Si true, el script sync-builderbot-subflow-prompts.mjs puede publicar a BB */
  syncScriptKey?: string;
};

export const BOT_PROMPT_MODULES: BotPromptModuleDef[] = [
  {
    key: "odometer",
    name: "Cambio Odómetro / Horómetro",
    description:
      "Cuando el cliente quiere cambiar odómetro u horómetro: patente, valores y confirmación.",
    flowLabel: "Cambio de odómetro / horómetro",
    sortOrder: 10,
    defaultFile: "odometro_prompt.txt",
    builderbotFlowId: "ae2a5ae9-c289-448c-a068-3cb8c65a2e7f",
    builderbotAnswerId: "0b66245a-c7cf-41e0-8eda-e30d74b80d96",
    syncScriptKey: "odometer",
  },
  {
    key: "consulta",
    name: "Consultar Unidad",
    description:
      "Cuando el cliente consulta estado de una unidad: patente, último reporte, ubicación, etc.",
    flowLabel: "Consulta de unidades",
    sortOrder: 20,
    defaultFile: "consulta_unidad_prompt.txt",
    builderbotFlowId: "5939a04e-5a5a-4c59-83b6-31172eba4828",
    builderbotAnswerId: "790bd170-0443-4129-be5b-9944b4c03911",
    syncScriptKey: "consulta",
  },
  {
    key: "mantenimiento_info",
    name: "Información Mantenimiento",
    description:
      "Responde dudas sobre el módulo de mantenimiento: planes, tareas, preventivo y correctivo.",
    flowLabel: "Consultas sobre mantenimiento",
    sortOrder: 30,
    builderbotFlowId: "069bcb65-7503-433c-a4ae-1dd89cd26471",
    builderbotAnswerId: "ca1aff0d-b862-4be8-a4d4-6b160ce1bfba",
  },
  {
    key: "opciones_info",
    name: "Información Opciones",
    description:
      "Guía del módulo Opciones: Agenda, Notificaciones, Perfiles y futuras fichas de plataforma.",
    flowLabel: "Consultas sobre Opciones (guía)",
    sortOrder: 35,
    defaultFile: "opciones_info_prompt.txt",
    builderbotFlowId: "312ea5a6-0493-43e6-b026-05d14bcb6436",
    builderbotAnswerId: "51d23e45-2a51-4400-bdf5-8411ee6d66c7",
    syncScriptKey: "opciones_info",
  },
  {
    key: "unidades_info",
    name: "Información Unidades",
    description:
      "Guía del módulo Unidades: panel de flota, grupos, ficha expandida, MIS ATAJOS y controles del mapa.",
    flowLabel: "Consultas sobre Unidades (guía)",
    sortOrder: 36,
    defaultFile: "unidades_info_prompt.txt",
    builderbotFlowId: "52f8a36b-819b-4edb-aeb7-677041797a31",
    builderbotAnswerId: "3aa329af-4b8e-4e55-abe3-ea7a742bd785",
    syncScriptKey: "unidades_info",
  },
  {
    key: "certificados",
    name: "Certificados de cobertura",
    description:
      "Cuando piden certificado de cobertura: patente y confirmación antes de generarlo.",
    flowLabel: "Certificados de cobertura",
    sortOrder: 40,
    builderbotFlowId: "fd2e658c-f547-4ec6-b64f-00815620bd6b",
  },
  {
    key: "mantenimiento_operativo",
    name: "Gestión Mantenimiento",
    description:
      "Cuando gestionan una tarea o correctivo: patente, descripción y confirmación.",
    flowLabel: "Gestión de mantenimiento operativo",
    sortOrder: 50,
    builderbotFlowId: "42b29014-7560-4a67-bc09-0201eb1efdd5",
  },
];

export function getBotPromptModuleDef(key: string): BotPromptModuleDef | undefined {
  return BOT_PROMPT_MODULES.find((m) => m.key === key);
}

export function buildModulePlaceholder(def: BotPromptModuleDef): string {
  return [
    `=== ATILIO — ${def.name.toUpperCase()} (BB Whatsapp) ===`,
    "VERSIÓN: borrador",
    `CONTEXTO: ${def.description}`,
    "==================================================",
    "",
    "IDENTIDAD Y MISIÓN",
    `Sos Atilio, agente de Mesa de Ayuda de Wara. Estás ayudando con: ${def.name}.`,
    "Conversá en español, breve y profesional.",
    "Pedí solo los datos necesarios y no inventes resultados.",
    "",
    "TONO",
    "- Una pregunta por turno.",
    "- Sin párrafos largos.",
    "- Si el cliente cambia de tema, volvé al trámite o derivá a un asesor.",
  ].join("\n");
}
