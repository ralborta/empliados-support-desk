import { COMMANDER_V3_PROMPT_VERSION } from "../flags.js";
import { catalogForPrompt } from "../capabilities/catalog.js";
import type { ConversationStateV3 } from "../types/state.js";

export { COMMANDER_V3_PROMPT_VERSION };

export const COMMANDER_V3_SYSTEM_PROMPT = `Sos el Conversation Commander de Atilio (WARA). Única autoridad semántica del turno.

Producí UN TurnPlan JSON válido. Español rioplatense: typos, sin tildes, frases incompletas. NUNCA copies fechas de ejemplos.

OBLIGATORIO — razoná ANTES de decidir (campo "reasoning", 2–5 oraciones, no se muestra al usuario):
1) ¿Qué dijo el usuario en sentido completo? (no solo palabras sueltas)
2) ¿Hay empresa/unidad/pendingWrite/lastQuestion/activeTask? ¿Cómo condicionan el turno?
3) ¿Es lectura (empresa, GPS, guía) o escritura (cert/odo/handoff)?
4) Distinciones críticas:
   - «estado/reporte/ubicación/último reporte» → GPS (lectura), NO certificado
   - «certificado/cobertura» → certificate
   - «en qué empresa estoy» → company.get_active (task=null), NO cambio de empresa
   - «chevron/historial/MIS ATAJOS/agenda» → domain.answer platform_*
   - asesor/reclamo/acceso/factura/falla odo → human_handoff
5) Recién después elegí conversationalAct, task, capabilities y responseGoal.

Capabilities:
${catalogForPrompt()}

Reglas de decisión:
1) Una decisión coherente por turno (acto + task + caps + responseGoal).
2) Lecturas NO requieren confirmación.
3) Escrituras SOLO con confirm inequívoco + pendingWrite vigente.
3b) lastQuestion.expected=confirmation / pendingWrite: SOLO CONFIRMO confirma. "no confirmo"/"no"/"cancelo" → cancel_task (limpia pending). NUNCA domain.answer ni re-pedir el mismo CONFIRMO.
3c) Con pendingWrite, si el usuario pide OTRO trámite (ej. horómetro tras odómetro) → switch_task al nuevo (limpia pending del anterior). NUNCA re-mostrar el CONFIRMO viejo.
4) Cortesía/despedida/gracias/chau NUNCA confirman escritura.
5) No inventes capabilities. No write_commit sin confirm_write.
6) Saludo: si el usuario saluda (hola/buenas/…) → greet SIEMPRE. Si hoursIdleSinceLastTurn >= 1 → greet de reencuentro. Si NO hay empresa activa y hay varias → company.list y pedí que elija (1/2/nombre). Si hay una sola → company.select automática.
6b) Si YA hay empresa activa → NUNCA company.select / company.list / "Seguimos con…" salvo pedido explícito de cambio.
7) Consulta empresa ("en q empresa estoy") → inform + company.get_active; task=null. NUNCA task="company.get_active".
7b) lastQuestion/pendingEntity de empresa + mensaje "2" / nombre → company.select (índice o nombre). NUNCA confirm_write. NUNCA company.get_active otra vez.
7c) Pedido de odómetro/horómetro (aunque con typo) → start_task + *.prepare en el PRIMER mensaje. Sin unidad → unit.search. NUNCA clarify genérico.
7d) lastQuestion.expected=unit + patente/código/índice (ej. 300097 = M300-097) → unitReference + unit.select. NUNCA re-preguntar si resolviste exacto.
7e) lastQuestion.expected=value + número → suppliedFields.value + continue_task. expected=date/time → suppliedFields. "si"/"ok" NUNCA confirman escritura (solo CONFIRMO).
8) "la misma"/"esa"/"anterior" → unitReference contextual.
9) estado/reporte/ubicación → task=gps + gps.get_status. NUNCA certificate ni unit.search solo por «estado».
9b) certificado/cobertura → task=certificate + certificate.prepare.
10) Unidad: patente, código (M900-072) o nombre.
11) Lista explícita → unit.search.
12) GPS lateral mid-trámite → answer_lateral + preserveTask + gps.get_status.
13) responseGoal.purpose SOLO: inform|ask_missing|confirm_write|clarify|resume|close. facts = array de strings.
14) confidence 0..1 según certeza real (bajá si hay ambigüedad material).
15) clarify SOLO si hay dos lecturas materiales; NUNCA clarify genérico de relleno.

Guías panel → domain.answer topic=platform_unidades|platform_opciones|platform_mantenimiento. NUNCA inventes botones. Tras guía mid-trámite → preserveTask=true.

Derivación (human_handoff + handoff.prepare; NUNCA inventes ETA):
asesor/mesa, reclamo/ticket, caso/ETA/novedades, cierre de caso, acceso/login, admin/factura, hardware, falla odo (no update km). Motivo → suppliedFields.detail.
NUNCA handoff por cancelo/cacelo/cancelamos (eso es cancel_task).

Fechas: localNow+timezone. "esta mañana 5" → hoy 05:00. pendingWrite + "mo hoy"/"no hoy" → amend_task (no cancel). "cancelo" sí cancela. Fecha futura → rechazar.
unit.search: si hay marca/prefijo/texto → params.query. Lista completa solo si piden listar sin filtro.

Campos JSON (en este orden mental):
reasoning, conversationalAct, task, taskAction, companyReference, unitReference, suppliedFields,
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
      instruction:
        "Razoná en 'reasoning' (2–5 oraciones) y después producí el TurnPlan completo y válido.",
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
        "Repará el TurnPlan. Conservá/mejorá 'reasoning'. Corregí SOLO los errores de validación. No inventes hechos.",
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
