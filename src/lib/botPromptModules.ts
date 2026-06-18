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
      "Subflujo conversacional que reúne patente, odómetro/horómetro y confirmación CONFIRMO antes de ejecutar en Wara.",
    flowLabel: "Cambio Odómetro → Ejecutar Odómetro",
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
      "Subflujo que identifica patente o intención de consulta antes de llamar a la API de estado de unidades.",
    flowLabel: "Consultar Unidad → Ejecutar Consulta Unidad",
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
      "FAQ del módulo de mantenimiento Wara (planes, tareas, preventivo/correctivo). Usa el PDF de conocimiento en BuilderBot.",
    flowLabel: "Información Mantenimiento (ChatPDF)",
    sortOrder: 30,
    builderbotFlowId: "069bcb65-7503-433c-a4ae-1dd89cd26471",
  },
  {
    key: "certificados",
    name: "Certificados de cobertura",
    description:
      "Instrucciones del subflujo que pide patente y confirma antes de generar el certificado en Wara.",
    flowLabel: "Certificados → Ejecutar Certificados",
    sortOrder: 40,
    builderbotFlowId: "fd2e658c-f547-4ec6-b64f-00815620bd6b",
  },
  {
    key: "mantenimiento_operativo",
    name: "Gestión Mantenimiento",
    description:
      "Subflujo operativo: patente, descripción de tarea/correctivo y confirmación antes de registrar la gestión.",
    flowLabel: "Gestión Mantenimiento → Ejecutar Gestión Mantenimiento",
    sortOrder: 50,
    builderbotFlowId: "42b29014-7560-4a67-bc09-0201eb1efdd5",
  },
];

export function getBotPromptModuleDef(key: string): BotPromptModuleDef | undefined {
  return BOT_PROMPT_MODULES.find((m) => m.key === key);
}

export function buildModulePlaceholder(def: BotPromptModuleDef): string {
  return [
    `=== ATILIO_SUBFLUJO_${def.key.toUpperCase()} (BuilderBot Cloud SaaS) ===`,
    "VERSIÓN: borrador-panel",
    `CONTEXTO: ${def.description}`,
    "VERIFICACIÓN: editá este texto desde Configuración en el panel. La publicación en BuilderBot se hace por script MCP (sync automático pendiente).",
    "==================================================",
    "",
    "IDENTIDAD Y MISIÓN",
    `Sos Atilio en el subflujo "${def.name}".`,
    "Conversá en español, breve y profesional.",
    "Pedí solo los datos mínimos y no inventes resultados de APIs.",
    "",
    "TONO",
    "- Una pregunta por turno.",
    "- Sin párrafos largos.",
    "- Si el cliente cambia de tema, derivá al Router o al flujo correspondiente.",
  ].join("\n");
}
