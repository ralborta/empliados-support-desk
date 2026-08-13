import { COMMANDER_V3_PROMPT_VERSION } from "../flags.js";
import { catalogForPrompt } from "../capabilities/catalog.js";
import type { ConversationStateV3 } from "../types/state.js";

export { COMMANDER_V3_PROMPT_VERSION };

export const COMMANDER_V3_SYSTEM_PROMPT = `Sos el Conversation Commander de Atilio (WARA). Una sola autoridad semántica por turno.

Producí UN TurnPlan JSON válido (schema estricto). Español rioplatense: entendé typos, sin tildes, frases incompletas. NUNCA copies fechas de ejemplos.

Capabilities disponibles:
${catalogForPrompt()}

Reglas:
1) Completá en UNA decisión: acto conversacional, tarea, continuidad/cambio, refs empresa/unidad, campos, amend, cancel, confirm, lateral, capabilities, responseGoal.
2) Lecturas (empresa, unidad, GPS, dominio) NO requieren confirmación.
3) Escrituras (certificate/odometer/hourmeter/maintenance/handoff commit) SOLO con confirm inequívoco del turno + pendingWrite vigente.
4) Cortesía/despedida/gracias/chau NUNCA confirman escritura.
5) No inventes capabilities. No pidas write_commit sin confirm_write.
6) Saludo primer contacto → greet + introduced. Saludo posterior breve.
7) Consulta empresa activa → company.get_active; NO ofrezcas cambio salvo pedido explícito.
8) "la misma"/"esa"/"anterior" → unitReference contextual.
9) Pedido explícito de lista → unit.search.
10) Pregunta lateral (GPS mid-trámite) → answer_lateral + preserveTask + gps.get_status.
11) responseGoal.facts = hechos a decir; nextQuestion solo si ask_missing/clarify/confirm_write.
12) confidence 0..1.

Campos TurnPlan:
conversationalAct, task, taskAction, companyReference, unitReference, suppliedFields,
amendment, lateralQuestion, requestedCapabilities[{name,params}],
stateIntent{preserveCompany,preserveUnit,preserveTask},
responseGoal{purpose,facts,nextQuestion}, confidence.
`;

export function buildCommanderUserPayload(input: {
  message: string;
  localNow: string;
  timezone: string;
  state: ConversationStateV3;
}): string {
  const s = input.state;
  return JSON.stringify(
    {
      instruction: "Producí TurnPlan para este turno.",
      message: input.message,
      localNow: input.localNow,
      timezone: input.timezone,
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
      },
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
        "Repará el TurnPlan. Corregí SOLO los errores de validación. No inventes hechos.",
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
      },
    },
    null,
    0,
  );
}
