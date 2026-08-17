import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import { listRegistryForPrompt } from "../registry/service-registry.js";

export const INTERPRETER_SYSTEM_PROMPT = `Eres el intérprete conversacional de Atilio (WARA). Tu única tarea es entender el mensaje ACTUAL del usuario en contexto.

Devuelve JSON con:
- userAct: greeting|request|answer|question|correction|confirmation|cancellation|rejection|acknowledgement|unknown
- relation: standalone|answer_expected|continue|side_question|switch|pause|resume|replace|cancel|confirm|ambiguous
- normalizedMeaning: qué quiere el usuario ahora (1-2 frases)
- requests: [{ serviceId, domain, goal, entities (objeto JSON {}, NUNCA array), operationHint (conversation|read|write|handoff u omitir) }]
- references: [{ type, expression, source, index }]
- corrections: [{ field, value }]
- answersExpectedField: boolean
- expectedFieldValue: valor si el usuario respondió al campo esperado
- confidence: 0-1
- ambiguity: opcional si no puedes decidir
- confirmation: opcional { intended, containsCorrections, targetOperationId }

Reglas:
1. El mensaje actual manda. No reabrir trámites por lastQuestion/expectedInput.
2. Saludo puro ("Hola") con trabajo incompleto → relation=pause o side_question, NO answer_expected. Si openWork no es null, el saludo no cancela ni reemplaza ese trámite.
3. Pregunta lateral sobre empresa/unidad NO cancela el trámite abierto → side_question.
4. expectedInput es contexto, no orden: no asumas que el usuario está respondiendo si su acto es greeting/question/switch.
5. Abandono explícito del trámite abierto → relation=switch o replace (NO ambiguous). Ej: "dejá eso", "mejor cargamos km", "olvidate del GPS", "eso después".
6. Pregunta lateral mientras hay trámite → side_question (conservar trámite).
7. No inventes patentes, empresas, valores ni resultados.
8. serviceId debe existir en el registro.

Registro de servicios:
${listRegistryForPrompt()}`;

export function buildInterpreterUserPayload(input: {
  message: string;
  state: ConversationStateV3;
  lastAssistantReply?: string | null;
}): string {
  const s = input.state;
  const openWork = s.activeTask
    ? {
        type: s.activeTask.type,
        status: s.activeTask.status,
        missing: s.activeTask.missing,
      }
    : null;
  const expected = s.lastQuestion
    ? {
        purpose: s.lastQuestion.purpose,
        expected: s.lastQuestion.expected,
      }
    : null;
  return JSON.stringify({
    message: input.message,
    lastAssistantReply: input.lastAssistantReply ?? null,
    company: s.company?.name ?? null,
    unit: s.unit?.label ?? null,
    openWork,
    expectedInput: expected,
    pendingWrite: s.pendingWrite
      ? { task: s.pendingWrite.task, operationId: s.pendingWrite.operationId }
      : null,
    parkedTurn: s.conversationMetadata.parkedTurn ?? null,
    recentTurns: s.recentTurns.slice(-6),
  });
}
