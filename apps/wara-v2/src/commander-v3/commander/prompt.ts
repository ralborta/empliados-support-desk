import { COMMANDER_V3_PROMPT_VERSION } from "../flags.js";
import { catalogForPrompt } from "../capabilities/catalog.js";
import type { ConversationStateV3 } from "../types/state.js";

export { COMMANDER_V3_PROMPT_VERSION };

export const COMMANDER_V3_SYSTEM_PROMPT = `Sos el Conversation Commander de Atilio (WARA). Única autoridad semántica del turno.

Producí UN TurnPlan JSON válido. WhatsApp rioplatense: typos, sin tildes, frases cortas, abreviaturas. NUNCA copies fechas de ejemplos.

Entendé qué quiere ESTA persona EN ESTE hilo. Leé el mensaje + lastAssistantReply + lastTurn + state. No clasifiques por palabras sueltas ni imites un menú rígido.

interpretation (obligatorio, ANTES de elegir tools):
- userQuestion: qué pidió o preguntó, sentido completo (no el texto crudo).
- answerKind: yes_no | status | how_to | list | start_task | continue_task | clarify | close | greet | other
- priorReply: si el mensaje solo se entiende con lo que Atilio dijo recién → relevant=true, summary, refersTo last_facts|last_question|active_entity. Si se entiende solo → relevant=false, refersTo=none.

Qué hacer con eso:
- Quiere que Atilio HAGA un trámite (registrar km/hs, certificado, OT, reporte GPS de una unidad, listar flota) → start_task o continue_task + la capability de ese trámite. El nombre del trámite ES el trámite, no una guía del panel.
- Pregunta cómo usar el panel o qué es un concepto → how_to + domain.answer.
- Pregunta sobre un hecho (si la posición es correcta, si está al día) → yes_no o status + tools de evidencia. NUNCA sustituyas esa pregunta por un listado.
- Anáfora (su/esa/la/esa unidad) → state.unit si existe. Unidad activa no cambia salvo que nombren otra.
- Pedí SOLO lo que falta. Una pregunta por turno. Usá empresa/unidad/campos ya en state.
- Si no entendés, clarify UNA pregunta concreta. No inventes unidades, casos, plazos ni "no hay información" si hay facts o state.

Tools: traen evidencia o preparan el trámite declarado. responseGoal.facts vacío si la tool trae los hechos. yes_no|status|how_to → NUNCA unit.search.

Seguridad (no es intención):
- Escritura SOLO con la palabra CONFIRMO y pendingWrite vigente. "dale"/"ok"/"si" no confirman.
- Cancelar escritura: cancelar / no confirmo / no, con pendingWrite.
- No write_commit sin confirm_write. No inventes capabilities.

Capabilities:
${catalogForPrompt()}

Campos JSON: interpretation, reasoning, conversationalAct, task, taskAction, companyReference, unitReference, suppliedFields, amendment, lateralQuestion, requestedCapabilities[{name,params}], stateIntent, responseGoal{purpose,facts,nextQuestion}, confidence.
purpose SOLO: inform|ask_missing|confirm_write|clarify|resume|close.
`;

export function buildCommanderUserPayload(input: {
  message: string;
  localNow: string;
  timezone: string;
  state: ConversationStateV3;
}): string {
  const s = input.state;
  const lastAssistant = [...s.recentTurns]
    .reverse()
    .find((t) => t.role === "assistant");

  return JSON.stringify(
    {
      instruction:
        "Interpretá el hilo (mensaje + lastAssistantReply + lastTurn + state). Completá interpretation primero. Las tools sirven a ESA petición. No rutees por palabras sueltas.",
      message: input.message,
      localNow: input.localNow,
      timezone: input.timezone,
      hoursIdleSinceLastTurn: Number(
        (
          (Date.now() - Date.parse(s.updatedAt || "")) /
          (60 * 60 * 1000)
        ).toFixed(2),
      ),
      state: {
        company: s.company,
        unit: s.unit,
        previousUnit: s.previousUnit,
        availableCompanies: s.availableCompanies.map((c) => ({
          id: c.id,
          name: c.name,
        })),
        activeTask: s.activeTask,
        pendingEntity: s.pendingEntity,
        pendingWrite: s.pendingWrite
          ? {
              operationId: s.pendingWrite.operationId,
              version: s.pendingWrite.version,
              task: s.pendingWrite.task,
              summary: s.pendingWrite.summary,
            }
          : null,
        suspendedTask: s.suspendedTask
          ? { type: s.suspendedTask.task.type, reason: s.suspendedTask.reason }
          : null,
        lastQuestion: s.lastQuestion,
        lastListing: s.lastListing
          ? {
              kind: s.lastListing.kind,
              page: s.lastListing.page,
              totalCount: s.lastListing.totalCount,
              visible: s.lastListing.items.slice(0, 12),
            }
          : null,
        introducedAtilio: s.conversationMetadata.introducedAtilio,
        lastGpsIncident: s.conversationMetadata.lastGpsIncident
          ? {
              plate: s.conversationMetadata.lastGpsIncident.plate,
              titleSuffix: s.conversationMetadata.lastGpsIncident.titleSuffix,
              odooRef: s.conversationMetadata.lastGpsIncident.odooRef,
            }
          : null,
        lastTurn: s.conversationMetadata.lastTurn ?? null,
      },
      lastAssistantReply: lastAssistant?.text
        ? lastAssistant.text.slice(0, 1800)
        : null,
      recentTurns: s.recentTurns.slice(-8),
    },
    null,
    0,
  );
}

export function buildRepairUserPayload(input: {
  originalMessage: string;
  previousPlan: unknown;
  validationErrors: string[];
  state: ConversationStateV3;
  allowedCorrections: string[];
}): string {
  return JSON.stringify(
    {
      instruction:
        "Repará el TurnPlan. Conservá interpretation (completalo si falta). Corregí SOLO los errores de validación. No inventes hechos. No rutees por el texto del mensaje.",
      originalMessage: input.originalMessage,
      previousPlan: input.previousPlan,
      validationErrors: input.validationErrors,
      allowedCorrections: input.allowedCorrections,
      stateSummary: {
        company: input.state.company?.name ?? null,
        unit: input.state.unit?.label ?? null,
        activeTask: input.state.activeTask?.type ?? null,
        pendingWrite: Boolean(input.state.pendingWrite),
        lastQuestion: input.state.lastQuestion,
        lastTurn: input.state.conversationMetadata.lastTurn ?? null,
        lastAssistantReply:
          [...input.state.recentTurns]
            .reverse()
            .find((t) => t.role === "assistant")?.text?.slice(0, 800) ?? null,
      },
    },
    null,
    0,
  );
}
