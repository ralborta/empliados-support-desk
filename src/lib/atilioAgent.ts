/**
 * Agente conversacional Atilio — interpreta el hilo, ejecuta tools y RAZONA la respuesta.
 * El backend devuelve hechos (dialogue_state); el agente redacta en diálogo natural.
 *
 * Activar: WARA_AGENT_MODE=true (+ OPENAI_API_KEY).
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
import { formatCalendarContextBlock } from "@/lib/odometroFecha";
import { isAtilioAgentEnabled } from "@/lib/atilioDialogueCompose";
import {
  looksLikeGenericCapabilityOrTopicSwitchRequest,
  looksLikeSubstantiveCustomerMessage,
  looksLikeUnitConsultFollowUp,
  threadHasRecentUnitCaseOpened,
} from "@/lib/waraApi";
import { isStructuredWhatsAppTemplate } from "@/lib/waraWhatsAppFormat";
import {
  isOdometerFlowSuperseded,
  looksLikeOdometerInfoRequest,
  looksLikeStructuredOdometerUpdateRequest,
  threadHasActiveOdometerFlow,
  threadOdometerRegistrationCompleted,
  looksLikeAnotherUnitConsultRequest,
} from "@/lib/wara";
import { shouldRouteTurnToOdometerExecutor, shouldRouteTurnToFleetListExecutor, shouldRouteTurnToUnidadesExecutor } from "@/lib/waraUnitIntent";
import { looksLikePossibleFleetListRequest } from "@/lib/fleetListIntentAI";

export { isAtilioAgentEnabled, composeAgentReplyFromDialogueState, type ComposeDialogueInput } from "@/lib/atilioDialogueCompose";

export const ATILIO_AGENT_TIMEOUT_MS = 28_000;

const MAX_TOOL_ROUNDS = 2;

function agentModel(): string {
  return process.env.WARA_AGENT_MODEL?.trim() || "gpt-4o-mini";
}

const CORE_SYSTEM_PROMPT = `Sos Atilio, agente de Mesa de Ayuda Wara por WhatsApp. Escuchás, razonás, dialogás — NO sos un bot de plantillas ni un formulario.

FILOSOFÍA (lo más importante):
- Sos un AGENTE, no un bot de menús. El cliente habla como persona: incompleto, con typos, en desorden.
- Entendé la INTENCIÓN del cliente, no solo palabras exactas. Si dice "me pasás mi lista", "algo raro con la camioneta", "no me cierra", interpretá el requerimiento real antes de actuar.
- DESORDEN ES NORMAL: pueden mandar km antes que la patente, la fecha después, el síntoma mezclado con otra pregunta, o saltar pasos. NO exijas el orden del trámite. Tomá lo que ya trajeron del hilo + mensaje y pedí SOLO lo que falta, en una pregunta natural.
- Cuando la herramienta devuelve datos (flota, unidades, estados), aplicá CRITERIO DE SELECCIÓN: elegí según lo que el cliente pidió (patente, prefijo, marca, síntoma), no la primera coincidencia ni un ejemplo del historial.
- Si piden listado/flota/todas las unidades (aunque lo digan distinto: "mi lista", "mis camiones", "cuántas tengo"), llamá consultar_unidades — NUNCA pidas patente para "poder listar" (si no recuerdan, justamente quieren la lista).
- Las DERIVACIONES deben ser claras y justificadas: ticket/asesor cuando corresponde técnicamente; guía cuando es informativo; observación cuando no hace falta escalar. Nunca derives "por las dudas" ni evites derivar cuando el backend ya abrió caso.
- Respuestas y preguntas ABIERTAS: tono humano, rioplatense, flexible — nunca párrafos clonados ni el mismo bloque repetido en cada turno.

AMBIGÜEDAD (razonar, no formulario):
- Si no estás seguro entre listado de flota vs consulta de UNA unidad, NO tires el bloque genérico de "pasame la patente/marca".
- Preguntá en natural, una sola cosa: "¿Querés que te pase el listado de tus unidades, o buscás una patente en particular?" / "Perdón, ¿me pediste la lista de la flota?"
- Si suena a listado aunque no lo digan literal → consultar_unidades igual; el backend devuelve hechos.
- Si suena a una unidad concreta → consultar_unidades con ese dato; si falta, preguntá qué unidad sin repetir el mismo párrafo del turno anterior.
- Marca, prefijo o patente incompleta ("la Nissan", "empieza con AG", "OST") → SIEMPRE consultar_unidades: el backend busca similares en la flota y lista opciones. NUNCA pidas "patente completa" sin haber buscado antes.
- Cuidado: "NRO", "N°", "número 12" NO son prefijo de patente — son número administrativo (caso/interno). Si el mensaje es ambiguo entre matrícula y número, PREGUNTÁ ("¿A qué te referís: una patente o un número de caso/interno?") — NUNCA inventes ni busques flota a ciegas.
- Si no estás seguro de qué pidió el cliente → una sola pregunta aclaratoria en natural. Mejor preguntar que equivocarse.
- Plantilla de cambio de odómetro (Interno M300-xxx, Km actual, Fecha/Hora, "mando interno con km desfasados") → registrar_odometro_horometro SIEMPRE — NO derivar_asesor_ticket ni bloquear por caso abierto previo.

EN CADA TURNO:
1. Leé el mensaje actual: ¿qué necesita el cliente en concreto (explícito o implícito)?
2. Si hay acción operativa, SIEMPRE llamá la herramienta — NUNCA inventes diagnósticos sin herramienta.
3. Redactá natural: primero respondé lo que preguntó, después solo el contexto mínimo necesario.

DIÁLOGO (crítico):
- No repitas el mismo párrafo en turnos seguidos.
- No ignores "hace cuánto", "verdad?", "y entonces?", "la misma", "esa".
- No uses tono de formulario ("Voy a registrar:", "necesito la patente (ej...)", "opción 1 / opción 2").
- Unidad: decila corto ("MYQ 693"), no el bloque nombre+largo siempre.
- Una pregunta por turno, conversacional — como un colega que sabe del tema.
- Si el cliente ya dio un dato (aunque fue "antes de tiempo" o en otro mensaje), NO lo vuelvas a pedir — EXCEPTO fecha y hora de lectura de odómetro/horómetro: si faltan, pedilas de nuevo.

REGLAS ABSOLUTAS:
- Nunca inventes patentes, km, fechas, estados ni tickets.
- Usá FECHA DE REFERENCIA para hoy/ayer/anteayer/lunes/martes/etc. Si el cliente usa una fecha relativa, resolvela y SIEMPRE mostrá el DD/MM/AAAA (y la hora si la dio) en tu respuesta y en el resumen — nunca digas solo “ayer” o “el lunes” sin la fecha concreta.
- ALCANCE DE ATILIO: GPS/estado de unidades, odómetro/horómetro, certificados, mantenimiento operativo, guías de módulos Wara. Si el cliente pide soporte FUERA de eso (pantalla táctil, hardware físico, garantía, facturación, o cualquier reclamo que no puedas resolver vos) → derivar_asesor_ticket de inmediato. NO pidas número de caso/ticket previo. NO inventes pasos. El backend crea el caso y lo asigna a un asesor.
- ODÓMETRO/HORÓMETRO (pedido Wara, confirmado 2026-08-06): fecha Y hora de la lectura son OBLIGATORIAS junto con el km/hs. Si el cliente no las entrega, pedilas de nuevo con ejemplo (ej. 05/08/26 a las 14:30) hasta que las pase. En el mensaje al cliente: tono natural — NO digas «sin fecha no registro» ni ofrezcas «ahora» (casi nunca lo usan). Internamente: sin fecha+hora NO digas CONFIRMO, NO asumas “hoy”, NO inventes hora, NO registres. Llamá registrar_odometro_horometro: el backend bloquea hasta tener esos datos.
- Trámite pendiente + confirmación → herramienta del trámite.
- Problema vago → preguntá qué ve antes de diagnosticar (sin asumir GPS).
- NO respondas sin herramienta si hay unidad activa, trámite pendiente o consulta reciente en curso.
- Si el hilo tiene trámite de ODÓMETRO/HORÓMETRO activo, usá registrar_odometro_horometro — NUNCA consultar_unidades salvo que pida explícitamente estado GPS o cambie de tema.
- Preguntas INFORMATIVAS sobre odómetro/horómetro ("¿para qué sirve?", "¿qué es?", "me explicás") → guia_informativa — NO registrar_odometro_horometro ni pedir km.
- Preguntas de CONFIGURACIÓN de plataforma (agenda, contactos, perfiles, notificaciones, opciones, cómo se usa un módulo) → SIEMPRE guia_informativa. NUNCA inventes botones ni pasos del manual.

CONSULTAS (alcance y brevedad):
- Meta-consulta sin tema ("¿puedo hacer una consulta?", "tengo una duda"): respondé MUY breve (2-3 líneas) — solo GPS/reporte, odómetro/horómetro, certificados, mantenimiento y guías Wara. Invitá a concretar. NO repitas menú largo ni diagnósticos.
- Consulta informativa DENTRO del alcance → respondé breve, directo al punto. NO manual largo salvo que pidan paso a paso.
- Consulta FUERA del alcance (factura, hardware, garantía, temas no Wara) → derivar_asesor_ticket en una línea. NO inventes ni te extiendas.`;

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
  threadText?: string;
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
  const threadText = opts.threadText?.trim() ?? "";
  if (
    threadText &&
    !threadOdometerRegistrationCompleted(threadText) &&
    !isOdometerFlowSuperseded(threadText) &&
    threadHasActiveOdometerFlow(threadText)
  ) {
    lines.push(
      "tramite_activo_hilo: odometro/horometro — el cliente está eligiendo unidad o cargando km/fecha/hora; fecha+hora OBLIGATORIAS; NO diagnosticar GPS.",
    );
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

function shouldRequireToolCall(params: {
  session: Awaited<ReturnType<typeof loadAgentSessionContext>>;
  threadText: string;
  selectionText: string;
}): boolean {
  const { session, threadText, selectionText } = params;

  if (looksLikeOdometerInfoRequest(selectionText)) {
    return true;
  }

  if (looksLikeGenericCapabilityOrTopicSwitchRequest(selectionText)) {
    return false;
  }

  if (looksLikeAnotherUnitConsultRequest(selectionText)) {
    return false;
  }

  if (looksLikeStructuredOdometerUpdateRequest(selectionText)) {
    return true;
  }

  if (
    shouldRouteTurnToUnidadesExecutor({
      selectionText,
      threadText,
    })
  ) {
    return true;
  }

  if (
    shouldRouteTurnToFleetListExecutor({
      selectionText,
      threadText,
    }) ||
    looksLikePossibleFleetListRequest(selectionText)
  ) {
    return true;
  }

  if (
    shouldRouteTurnToOdometerExecutor({
      selectionText,
      threadText,
      pendingActionType: session.pendingAction?.type ?? null,
    })
  ) {
    return true;
  }

  if (session.pendingAction) return true;

  const odometerFlowActive =
    !threadOdometerRegistrationCompleted(threadText) &&
    !isOdometerFlowSuperseded(threadText) &&
    threadHasActiveOdometerFlow(threadText);
  if (odometerFlowActive) return false;

  if (session.activeUnit?.plate) {
    if (looksLikeAnotherUnitConsultRequest(selectionText)) return false;
    if (looksLikeUnitConsultFollowUp(selectionText)) return true;
    if (looksLikeSubstantiveCustomerMessage(selectionText)) return true;
  }
  if (threadHasRecentUnitCaseOpened(threadText) && looksLikeSubstantiveCustomerMessage(selectionText)) {
    return true;
  }
  return false;
}

function shouldPassthroughBackendMessage(msg: string): boolean {
  if (isStructuredWhatsAppTemplate(msg)) return true;
  return (
    /listo,\s*registr[eé]/i.test(msg) ||
    /para registrar el cambio respond[eé] confirmo/i.test(msg) ||
    /Confirmar od[oó]metro|Confirmar hor[oó]metro/i.test(msg) ||
    /Respond[eé] \*CONFIRMO\* o \*CANCELAR\*/.test(msg) ||
    // Listados/aclaraciones de flota: no reescribir (el agente inventaba "mensaje incompleto"
    // ante typos de prefijo aunque el backend ya había listado las patentes).
    /encontr[eé]\s+\d+\s+unidades/i.test(msg) ||
    /unidades que (?:empiezan|comienzan) con/i.test(msg)
  );
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
  const threadText =
    input.threadCtx.scopedThread.trim() || input.threadCtx.classificationThread.trim() || "";
  const requireTool = shouldRequireToolCall({
    session,
    threadText,
    selectionText: input.selectionText,
  });

  const userBlock = [
    "=== FECHA DE REFERENCIA (obligatoria para hoy/ayer/anteayer) ===",
    formatCalendarContextBlock("America/Argentina/Buenos_Aires"),
    "",
    "=== CONTEXTO DE SESIÓN ===",
    buildSessionContextBlock({
      customerName: input.customerName ?? session.customerName,
      companyName: input.companyName ?? session.companyName,
      pendingAction: session.pendingAction,
      activeUnit: session.activeUnit,
      threadText,
    }),
    requireTool ? "requiere_herramienta: true (hay unidad activa o trámite — NO respondas sin tool)" : "",
    "",
    "=== HISTORIAL RECIENTE (más abajo = más reciente) ===",
    threadText || "(sin historial previo)",
    "",
    "=== MENSAJE ACTUAL DEL CLIENTE ===",
    input.selectionText.trim(),
  ]
    .filter(Boolean)
    .join("\n");

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
          tool_choice: round === 0 && requireTool ? "required" : "auto",
          temperature: 0.55,
        },
        { signal: controller.signal },
      );

      const choice = completion.choices[0]?.message;
      if (!choice) return null;

      if (!choice.tool_calls?.length) {
        if (requireTool && round === 0) continue;
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
          threadText,
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

        if (toolResult.composed_message) {
          return {
            message: toolResult.composed_message,
            executor: toolResult.executor,
            ok: toolResult.ok,
            usedAgent: true,
          };
        }

        if (toolResult.backend_message && shouldPassthroughBackendMessage(toolResult.backend_message)) {
          return {
            message: toolResult.backend_message,
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
            dialogue_state: toolResult.dialogue_state ?? null,
            backend_message: toolResult.backend_message,
            hint:
              "Redactá conversacional: respondé la intención del cliente, aplicá criterio sobre los hechos (no copies la plantilla), derivá solo si los hechos lo indican, una pregunta abierta si falta algo.",
          }),
        });
      }
    }

    const final = await openai.chat.completions.create(
      {
        model: agentModel(),
        messages,
        temperature: 0.5,
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
