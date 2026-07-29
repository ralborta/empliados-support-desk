/**
 * Agente conversacional Atilio — interpreta el hilo completo, elige la acción correcta
 * vía tools (ejecutores backend existentes) y redacta la respuesta de forma natural.
 *
 * Activar: WARA_AGENT_MODE=true (+ OPENAI_API_KEY).
 * Fallback automático al router de reglas si falla o no hay API key.
 */
import OpenAI from "openai";
import { prisma } from "@/lib/db";
import type { TurnThreadContext } from "@/lib/conversationThread";
import { getActiveUnit } from "@/lib/activeUnit";
import { getPendingAction, type PendingActionRecord } from "@/lib/pendingAction";
import { findCustomerByWhatsAppNumber } from "@/lib/whatsappPhone";
import type { TurnExecutorId } from "@/lib/whatsappTurnRouter";
import {
  ATILIO_AGENT_TOOLS,
  executeAtilioAgentTool,
  type AgentToolName,
} from "@/lib/atilioAgentTools";
import { listBotPromptModules } from "@/lib/botPromptStore";

export const ATILIO_AGENT_TIMEOUT_MS = 28_000;
const MAX_TOOL_ROUNDS = 2;

export function isAtilioAgentEnabled(): boolean {
  const raw = process.env.WARA_AGENT_MODE?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function agentModel(): string {
  return process.env.WARA_AGENT_MODEL?.trim() || "gpt-4o-mini";
}

const CORE_SYSTEM_PROMPT = `Sos Atilio, agente de Mesa de Ayuda Wara por WhatsApp. Sos una persona real del equipo de soporte: cercano, claro, breve, sin emojis, español rioplatense.

TU TRABAJO EN CADA TURNO:
1. Leé TODO el historial y el mensaje actual. Entendé en qué trámite están (odómetro, consulta GPS, certificado, mantenimiento, guía, asesor).
2. Si el cliente está en medio de un trámite, SEGUÍ ese trámite — no cambies de tema ni tires estado GPS si pidió odómetro, ni viceversa.
3. Si necesitás ejecutar una acción operativa (consultar unidad, registrar odómetro, certificado, mantenimiento, ticket, guía), llamá la herramienta correspondiente UNA vez por turno.
4. Con el resultado de la herramienta, redactá la respuesta final para WhatsApp: natural, conversacional, como escribiría un agente humano — NO copies el texto del backend palabra por palabra si suena robótico, pero SÍ preservá todos los datos exactos (patentes, km, horas, fechas, nombres de unidad).

REGLAS ABSOLUTAS:
- Nunca inventes patentes, km, horas, fechas, estados técnicos ni números de caso/ticket.
- Si la herramienta devolvió backend_message con datos, esos números y patentes deben aparecer EXACTAMENTE igual en tu respuesta.
- Si hay trámite pendiente de confirmación (pending_action), y el cliente dice CONFIRMO o corrige un dato, usá la herramienta del trámite activo.
- Si falta un dato (patente, km, etc.), preguntá UNA cosa concreta, mostrando que entendiste lo anterior — no repitas el guion de formulario.
- Si el cliente pide listado de flota para elegir unidad durante un trámite, eso sigue siendo parte del mismo trámite.
- No prometas tiempos de resolución. No des asesoramiento comercial/facturación.
- 1-5 oraciones salvo que haga falta un resumen de confirmación con datos.

Podés responder sin herramienta solo para aclaraciones muy breves cuando aún no hay acción que ejecutar; en cuanto haya acción operativa, usá la herramienta.`;

const BUSINESS_MODULE_KEYS = [
  "odometer",
  "consulta",
  "certificados",
  "mantenimiento_info",
  "opciones_info",
  "unidades_info",
] as const;

let cachedBusinessPrompt: { at: number; text: string } | null = null;
const BUSINESS_PROMPT_TTL_MS = 5 * 60 * 1000;

async function loadBusinessKnowledgeAppendix(): Promise<string> {
  const now = Date.now();
  if (cachedBusinessPrompt && now - cachedBusinessPrompt.at < BUSINESS_PROMPT_TTL_MS) {
    return cachedBusinessPrompt.text;
  }
  try {
    const modules = await listBotPromptModules();
    const text = modules
      .filter((m) => (BUSINESS_MODULE_KEYS as readonly string[]).includes(m.key))
      .map((m) => `## ${m.name}\n${m.content.trim().slice(0, 2000)}`)
      .join("\n\n");
    cachedBusinessPrompt = { at: now, text };
    return text;
  } catch {
    return "";
  }
}

export type AtilioAgentTurnInput = {
  rawPhone: string;
  selectionText: string;
  apiKey: string;
  threadCtx: TurnThreadContext;
  customerName?: string | null;
  companyName?: string | null;
};

export type AtilioAgentTurnResult = {
  message: string;
  executor: TurnExecutorId;
  ok: boolean;
  usedAgent: boolean;
};

function buildSessionContextBlock(opts: {
  customerName?: string | null;
  companyName?: string | null;
  pendingAction: PendingActionRecord | null;
  activeUnit: { plate: string; label?: string } | null;
}): string {
  const lines: string[] = [];
  if (opts.customerName?.trim()) lines.push(`cliente_nombre: ${opts.customerName.trim()}`);
  if (opts.companyName?.trim()) lines.push(`empresa_activa: ${opts.companyName.trim()}`);
  if (opts.activeUnit?.plate) {
    lines.push(
      `unidad_activa: ${opts.activeUnit.label?.trim() || opts.activeUnit.plate} (patente ${opts.activeUnit.plate})`,
    );
  }
  if (opts.pendingAction) {
    lines.push(`tramite_pendiente: ${opts.pendingAction.type}`);
    if (opts.pendingAction.summary) lines.push(`resumen_pendiente: ${opts.pendingAction.summary}`);
    if (opts.pendingAction.payload && Object.keys(opts.pendingAction.payload).length) {
      lines.push(`datos_pendientes: ${JSON.stringify(opts.pendingAction.payload)}`);
    }
  }
  return lines.length ? lines.join("\n") : "sin contexto de sesión adicional";
}

async function loadAgentSessionContext(rawPhone: string) {
  const customer = await findCustomerByWhatsAppNumber(prisma, rawPhone);
  const pendingAction = await getPendingAction(prisma, rawPhone);
  const activeUnit = await getActiveUnit(prisma, rawPhone);
  return {
    customerName: customer?.name ?? null,
    companyName: customer?.companyName ?? null,
    pendingAction,
    activeUnit: activeUnit?.plate
      ? { plate: activeUnit.plate, label: activeUnit.label }
      : null,
  };
}

function parseToolName(name: string): AgentToolName | null {
  const allowed = new Set(ATILIO_AGENT_TOOLS.map((t) => t.function.name));
  return allowed.has(name) ? (name as AgentToolName) : null;
}

export async function runAtilioAgentTurn(
  input: AtilioAgentTurnInput,
): Promise<AtilioAgentTurnResult | null> {
  if (!isAtilioAgentEnabled()) return null;
  if (!process.env.OPENAI_API_KEY?.trim()) return null;

  const session = await loadAgentSessionContext(input.rawPhone);
  const userBlock = [
    "=== CONTEXTO DE SESIÓN ===",
    buildSessionContextBlock({
      customerName: input.customerName ?? session.customerName,
      companyName: input.companyName ?? session.companyName,
      pendingAction: session.pendingAction,
      activeUnit: session.activeUnit,
    }),
    "",
    "=== HISTORIAL RECIENTE (más abajo = más reciente) ===",
    input.threadCtx.scopedThread.trim() || input.threadCtx.classificationThread.trim() || "(sin historial previo)",
    "",
    "=== MENSAJE ACTUAL DEL CLIENTE ===",
    input.selectionText.trim(),
  ].join("\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATILIO_AGENT_TIMEOUT_MS);

  let lastExecutor: TurnExecutorId = "unidades";
  let lastOk = true;

  try {
    const businessKnowledge = await loadBusinessKnowledgeAppendix();
    const systemPrompt = businessKnowledge
      ? `${CORE_SYSTEM_PROMPT}\n\n=== CONOCIMIENTO DEL NEGOCIO (Wara) ===\n${businessKnowledge}`
      : CORE_SYSTEM_PROMPT;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userBlock },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await openai.chat.completions.create(
        {
          model: agentModel(),
          messages,
          tools: ATILIO_AGENT_TOOLS as OpenAI.Chat.Completions.ChatCompletionTool[],
          tool_choice: round === 0 ? "auto" : "auto",
          temperature: 0.55,
        },
        { signal: controller.signal },
      );

      const choice = completion.choices[0]?.message;
      if (!choice) return null;

      if (!choice.tool_calls?.length) {
        const text = choice.content?.trim();
        if (!text) return null;
        return {
          message: text,
          executor: lastExecutor,
          ok: lastOk,
          usedAgent: true,
        };
      }

      messages.push(choice);

      for (const call of choice.tool_calls) {
        if (call.type !== "function") continue;
        const toolName = parseToolName(call.function.name);
        if (!toolName) continue;

        const toolResult = await executeAtilioAgentTool({
          toolName,
          rawPhone: input.rawPhone,
          customerMessage: input.selectionText,
          apiKey: input.apiKey,
        });
        lastExecutor = toolResult.executor;
        lastOk = toolResult.ok;

        if (toolResult.skip_response) {
          return {
            message: "",
            executor: toolResult.executor,
            ok: toolResult.ok,
            usedAgent: true,
          };
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: toolResult.ok,
            executor: toolResult.executor,
            backend_message: toolResult.backend_message,
            flow_complete: toolResult.flow_complete,
            hint: "Redactá la respuesta final para el cliente usando estos datos. Preservá patentes y números exactos del backend_message.",
          }),
        });
      }
    }

    const final = await openai.chat.completions.create(
      {
        model: agentModel(),
        messages,
        temperature: 0.45,
      },
      { signal: controller.signal },
    );
    const text = final.choices[0]?.message?.content?.trim();
    if (!text) return null;
    return {
      message: text,
      executor: lastExecutor,
      ok: lastOk,
      usedAgent: true,
    };
  } catch (err) {
    console.error("[atilioAgent] turn failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
