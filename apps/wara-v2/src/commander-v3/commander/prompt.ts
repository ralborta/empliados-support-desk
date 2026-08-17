import { COMMANDER_V3_PROMPT_VERSION } from "../flags.js";
import { catalogForPrompt } from "../capabilities/catalog.js";
import type { ConversationStateV3 } from "../types/state.js";

export { COMMANDER_V3_PROMPT_VERSION };

export const COMMANDER_V3_SYSTEM_PROMPT = `Sos el Conversation Commander de Atilio (WARA). Única autoridad semántica del turno.

Producí UN TurnPlan JSON válido. WhatsApp rioplatense: typos, sin tildes, frases cortas. NUNCA copies fechas de ejemplos.

Leé mensaje + lastAssistantReply + lastTurn + state.openWork. Entendé el hilo, no clasifiques por palabra suelta ni imites un menú rígido.

interpretation (obligatorio, ANTES de tools):
- userQuestion: sentido completo de lo que pidió (no el texto crudo).
- answerKind: yes_no | status | how_to | list | start_task | continue_task | clarify | close | greet | other
- threadRelation: capture | continue | interrupt | standalone | write_confirm | write_cancel
- priorReply: si el mensaje solo se entiende con lo que Atilio dijo recién → relevant=true. Si se entiende solo → relevant=false, refersTo=none.

threadRelation (UNA decisión; no un árbol de frases):
- capture: aporta el dato que pide lastQuestion.expected (patente, km, fecha, hora, empresa, índice).
- continue: sigue el MISMO caso (repite el pedido, aclara el mismo trámite).
- interrupt: hay openWork y este mensaje es OTRA cosa. No ejecutes. ask/clarify keep_or_close, CERO tools, parkedTurn. Preguntá si siguen el caso abierto o atienden lo nuevo. No contestes lo nuevo ni re-preguntes el slot.
- standalone: no hay openWork; contestá ESTE turno.
- write_confirm / write_cancel: solo con pendingWrite.

standalone: empresa activa → company.get_active. Estado de unidad → gps.get_status. Guía/how_to → domain.answer. answerKind=status no implica GPS.
Saludo PURO sin pedido → greet. Si lastAssistantReply ya fue el menú, no vuelvas a greet.
Cambio o reinicio de empresa → company.list params.reset=true. Listá empresas. NO pidas patente ni abras ticket. Al elegir empresa, EJECUTALA lo estacionado si había.
Registrar odómetro/horómetro → start_task + *.prepare. NUNCA yes_no, NUNCA "no se puede cambiar", NUNCA GPS.

Tools: evidencia de userQuestion. responseGoal.facts vacío si la tool trae los hechos. yes_no|how_to → NUNCA unit.search.

Seguridad (no es intención):
- Escritura SOLO con la palabra CONFIRMO y pendingWrite vigente. "dale"/"ok"/"si" no confirman.
- Cancelar escritura: cancelar / no confirmo / no, con pendingWrite.
- No write_commit sin confirm_write. No inventes capabilities.

Capabilities:
${catalogForPrompt()}

Campos JSON: interpretation, reasoning, conversationalAct, task, taskAction, companyReference, unitReference, suppliedFields, amendment, lateralQuestion, requestedCapabilities[{name,params}], stateIntent, responseGoal{purpose,facts,nextQuestion}, confidence.
purpose SOLO: inform|ask_missing|confirm_write|clarify|resume|close.
`;

function openWorkSummary(s: ConversationStateV3): {
  type: string;
  status: string;
  missing: string[];
  lastQuestionExpected: string | null;
  lastQuestionPurpose: string | null;
} | null {
  const t = s.activeTask;
  if (!t) return null;
  if (t.status === "awaiting_confirmation") {
    return {
      type: t.type,
      status: t.status,
      missing: t.missing ?? [],
      lastQuestionExpected: s.lastQuestion?.expected ?? null,
      lastQuestionPurpose: s.lastQuestion?.purpose ?? null,
    };
  }
  if (t.status === "collecting") {
    return {
      type: t.type,
      status: t.status,
      missing: t.missing ?? [],
      lastQuestionExpected: s.lastQuestion?.expected ?? null,
      lastQuestionPurpose: s.lastQuestion?.purpose ?? null,
    };
  }
  return null;
}

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
  const openWork = openWorkSummary(s);

  return JSON.stringify(
    {
      instruction:
        "Interpretá ESTE mensaje respecto de openWork. Si openWork existe y el mensaje no aporta el dato pedido ni sigue el mismo caso, threadRelation=interrupt (keep_or_close, CERO tools). Si no hay openWork, threadRelation=standalone y contestá esta pregunta.",
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
        openWork,
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
        parkedTurn: s.conversationMetadata.parkedTurn
          ? {
              answerKind: s.conversationMetadata.parkedTurn.answerKind,
              userQuestion: s.conversationMetadata.parkedTurn.userQuestion,
              task: s.conversationMetadata.parkedTurn.task,
            }
          : null,
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
        "Repará el TurnPlan. Conservá interpretation (userQuestion, threadRelation). Si el usuario pidió un trámite, el plan debe ser start_task/continue_task + la capability (no copies una pregunta abierta anterior). Corregí SOLO los errores de validación. No inventes hechos.",
      originalMessage: input.originalMessage,
      previousPlan: input.previousPlan,
      validationErrors: input.validationErrors,
      allowedCorrections: input.allowedCorrections,
      stateSummary: {
        company: input.state.company?.name ?? null,
        unit: input.state.unit?.label ?? null,
        activeTask: input.state.activeTask?.type ?? null,
        openWork: openWorkSummary(input.state),
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
