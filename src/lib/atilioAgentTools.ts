import { NextRequest } from "next/server";
import { POST as odooTicketPost } from "@/app/api/odoo/ticket/route";
import { POST as certificadosPost } from "@/app/api/wara/certificados/route";
import { POST as infoGuidesPost } from "@/app/api/wara/info-guides/route";
import { POST as mantenimientoPost } from "@/app/api/wara/mantenimiento-operativo/route";
import { POST as odometroPost } from "@/app/api/wara/odometro-horometro/route";
import { POST as unidadesPost } from "@/app/api/wara/unidades/route";
import {
  TURN_EXECUTOR_PATH,
  type TurnExecutorId,
} from "@/lib/whatsappTurnRouter";
import {
  agentComposeRequested,
  parseExecutorDialogueState,
} from "@/lib/executorDialogueState";
import { composeAgentReplyFromDialogueState } from "@/lib/atilioDialogueCompose";
import { MAINTENANCE_WHATSAPP_OPERATIVE_ENABLED } from "@/lib/waraApi";

const EXECUTOR_HANDLERS: Record<TurnExecutorId, (req: NextRequest) => Promise<Response>> = {
  unidades: unidadesPost,
  odometro: odometroPost,
  certificados: certificadosPost,
  mantenimiento: mantenimientoPost,
  odoo_ticket: odooTicketPost,
  info_guides: infoGuidesPost,
};

export type AgentToolName =
  | "consultar_unidades"
  | "registrar_odometro_horometro"
  | "certificado_cobertura"
  | "mantenimiento_operativo"
  | "derivar_asesor_ticket"
  | "guia_informativa";

const TOOL_TO_EXECUTOR: Record<AgentToolName, TurnExecutorId> = {
  consultar_unidades: "unidades",
  registrar_odometro_horometro: "odometro",
  certificado_cobertura: "certificados",
  mantenimiento_operativo: "mantenimiento",
  derivar_asesor_ticket: "odoo_ticket",
  guia_informativa: "info_guides",
};

type OpenAiToolDef = {
  type: "function";
  function: {
    name: AgentToolName;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown> };
  };
};

const BASE_AGENT_TOOLS: OpenAiToolDef[] = [
  {
    type: "function",
    function: {
      name: "consultar_unidades",
      description:
        "Consultar flota, listado, estado GPS/ignición en vivo, o buscar unidad por patente/marca/prefijo. Usala cuando la intención sea listado/flota/cuántas unidades (aunque lo digan distinto). Si la intención no está clara, el backend resuelve; vos redactás o preguntás en natural — NUNCA pidas patente solo para 'poder listar'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_odometro_horometro",
      description:
        "Registrar o modificar odómetro (km) u horómetro (horas) de una unidad. Requiere patente + valor (km/hs) + fecha Y hora de lectura (obligatorias). Si faltan fecha/hora, el backend las pide e insiste — no inventes ni asumas «ahora». Usar cuando el cliente quiere cambiar/actualizar/modificar/corregir odómetro u horómetro, o confirma con CONFIRMO un cambio pendiente.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "certificado_cobertura",
      description:
        "Generar o reenviar certificado de cobertura/monitoreo de una unidad. Requiere patente y confirmación CONFIRMO.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "derivar_asesor_ticket",
      description:
        "Derivar a asesor humano y asignar caso: reclamo/ticket, soporte fuera del alcance de Atilio (pantalla táctil, hardware, garantía, facturación), hablar con operador/mesa, o falla técnica que no sea GPS/odómetro/certificado/mantenimiento. Usar de inmediato — NO pedir número de caso previo ni patente si el tema no es de una unidad GPS. NUNCA uses esta tool solo porque el cliente mencionó mantenimiento.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "guia_informativa",
      description:
        "Fuente de verdad para módulos Wara (Opciones, Unidades, Mantenimiento): cómo usar la app, paso a paso preventivo/correctivo, troubleshooting si no pudo cargar, o la palabra suelta «Mantenimiento». Sin acciones en vivo. Con mantenimiento operativo deshabilitado por WhatsApp, SIEMPRE usá esta tool para cualquier tema de mantenimiento — NUNCA inventes programar/registrar por chat ni pidas unidad para agendar.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const MANTENIMIENTO_OPERATIVO_TOOL: OpenAiToolDef = {
  type: "function",
  function: {
    name: "mantenimiento_operativo",
    description:
      "Programar o registrar mantenimiento preventivo/correctivo operativo por WhatsApp (no guía informativa). Solo si la gestión operativa por WhatsApp está habilitada.",
    parameters: { type: "object", properties: {} },
  },
};

/** Tools expuestas al LLM según política de mantenimiento operativo. */
export function buildAtilioAgentTools(
  operativeEnabled: boolean = MAINTENANCE_WHATSAPP_OPERATIVE_ENABLED,
): OpenAiToolDef[] {
  if (operativeEnabled) {
    const tools = [...BASE_AGENT_TOOLS];
    const derivarIdx = tools.findIndex((t) => t.function.name === "derivar_asesor_ticket");
    tools.splice(Math.max(derivarIdx, 0), 0, MANTENIMIENTO_OPERATIVO_TOOL);
    return tools;
  }
  return BASE_AGENT_TOOLS;
}

/** @deprecated Preferí buildAtilioAgentTools() — lista estática con política vigente al import. */
export const ATILIO_AGENT_TOOLS = buildAtilioAgentTools();

/** Si el operativo WA está off, cualquier intento de esa tool se resuelve como guía. */
export function resolveAgentToolName(
  toolName: AgentToolName,
  operativeEnabled: boolean = MAINTENANCE_WHATSAPP_OPERATIVE_ENABLED,
): AgentToolName {
  if (!operativeEnabled && toolName === "mantenimiento_operativo") {
    return "guia_informativa";
  }
  return toolName;
}

async function invokeExecutorInternal(
  executor: TurnExecutorId,
  rawPhone: string,
  body: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const handler = EXECUTOR_HANDLERS[executor];
  const req = new NextRequest(`http://internal${TURN_EXECUTOR_PATH[executor]}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      from: rawPhone,
      phone: rawPhone,
      body,
      rawText: body,
    }),
  });
  const res = await handler(req);
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export type AgentToolResult = {
  ok: boolean;
  executor: TurnExecutorId;
  backend_message: string;
  composed_message?: string;
  dialogue_state?: import("@/lib/executorDialogueState").ExecutorDialogueState | null;
  flow_complete: boolean;
  skip_response: boolean;
  raw: Record<string, unknown>;
};

export async function executeAtilioAgentTool(params: {
  toolName: AgentToolName;
  rawPhone: string;
  customerMessage: string;
  apiKey: string;
  threadText?: string;
}): Promise<AgentToolResult> {
  const resolvedName = resolveAgentToolName(params.toolName);
  const executor = TOOL_TO_EXECUTOR[resolvedName];
  const raw = await invokeExecutorInternal(
    executor,
    params.rawPhone,
    params.customerMessage,
    params.apiKey,
  );
  const backendMessage = String(raw.message ?? raw.summaryText ?? "").trim();
  const ok = raw.ok !== false && raw.ok_s !== "false";
  const skipResponse = String(raw.skipResponse_s ?? "") === "true" && !backendMessage;
  const flowComplete = String(raw.flowComplete_s ?? "") === "true";
  const confirmationRequired = String(raw.confirmationRequired_s ?? "") === "true";
  const dialogueState = parseExecutorDialogueState(raw);
  let composedMessage: string | undefined;

  // Guía informativa: la salida del backend es la fuente de verdad (no reescribir a prosa libre).
  if (resolvedName === "guia_informativa" && backendMessage) {
    composedMessage = backendMessage;
  } else if (confirmationRequired && backendMessage) {
    composedMessage = backendMessage;
  } else if (agentComposeRequested(raw) && dialogueState) {
    composedMessage = await composeAgentReplyFromDialogueState({
      threadText: params.threadText ?? "",
      customerMessage: params.customerMessage,
      dialogueState,
      fallbackTemplate: backendMessage,
    });
  }

  return {
    ok,
    executor,
    backend_message: backendMessage,
    composed_message: composedMessage,
    dialogue_state: dialogueState,
    flow_complete: flowComplete,
    skip_response: skipResponse,
    raw,
  };
}

export function agentToolNameFromExecutor(executor: TurnExecutorId): AgentToolName | null {
  for (const [tool, ex] of Object.entries(TOOL_TO_EXECUTOR) as [AgentToolName, TurnExecutorId][]) {
    if (ex === executor) return tool;
  }
  return null;
}
