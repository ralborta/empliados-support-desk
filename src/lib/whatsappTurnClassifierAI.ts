/**
 * Clasificador semántico de turnos WhatsApp (capa IA antes del fallback regex).
 * Las guardas de seguridad y classifyTurnExecutor siguen siendo la red — la IA interpreta
 * intención + contexto cuando el mensaje es ambiguo (horómetro vs GPS, prefijos, guías).
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, logLlmStageError, withOpenAiTimeout } from "@/lib/openaiTimeout";
import {
  classifyTurnExecutor,
  classifyTurnExecutorSafetyGuards,
  type TurnExecutorId,
} from "@/lib/whatsappTurnRouter";
import {
  threadAwaitingHorometerKmValue,
  threadHasActiveOdometerFlow,
  threadOdometerRegistrationCompleted,
} from "@/lib/wara";
import {
  looksLikeCustomerConversationCloseRequest,
} from "@/lib/customerConversationClose";
import {
  looksLikeHumanAdvisorRequest,
  looksLikeExplicitReclamoOrTicketRequest,
  looksLikeTechnicalSupportRequest,
  looksLikeOperationalMaintenanceIntent,
  looksLikeFleetWideOutageClaim,
  looksLikeGpsOrUnitStatusQuestion,
  looksLikeLiveUnitConsultIntent,
} from "@/lib/waraApi";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
} from "@/lib/wara";
import { shouldRouteGpsConsultToUnidades } from "@/lib/gpsConsultRouting";

const TURN_AI_TIMEOUT_MS = OPENAI_DEFAULT_TIMEOUT_MS + 2_000;
const MIN_CONFIDENCE = 0.78;

const VALID_EXECUTORS = new Set<TurnExecutorId>([
  "unidades",
  "odometro",
  "certificados",
  "mantenimiento",
  "odoo_ticket",
  "info_guides",
]);

export type TurnExecutorResolution = {
  executor: TurnExecutorId;
  source: "safety_guard" | "ai" | "rules" | "default";
  ruleId?: string;
  aiConfidence?: number;
  /** Interpretación única del turno (reutilizar; no reinterpretar). */
  interpret?: import("@/lib/infoGuideInterpretAI").PlatformKnowledgeInterpret | null;
};

export function isTurnAiClassifyEnabled(): boolean {
  const raw = process.env.WARA_TURN_AI_CLASSIFY?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  // Desactivado por defecto: la IA de routing sumaba latencia y desvíos (GPS/Nissan
  // en medio de horómetro). Activar explícitamente con WARA_TURN_AI_CLASSIFY=true.
  return false;
}

async function classifyGpsReadTargetWithAi(
  text: string,
  threadText: string,
): Promise<"live_unit" | "platform_report" | "other"> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    logLlmStageError("gps_read_target", new Error("missing_openai_api_key"));
    return "other";
  }
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: [
                  "Clasificá el objeto de esta consulta de lectura en WARA.",
                  "El mensaje actual manda sobre el historial: una pregunta nueva reemplaza el tema anterior.",
                  "live_unit: estado, GPS, posición, ignición o reporte actual de una unidad concreta. Si pregunta dónde está una unidad identificada, siempre es live_unit aunque antes hablara de Informes.",
                  "platform_report: pregunta cómo consultar, ver o listar informes de la plataforma; incluye informes cuyos nombres contienen flota, unidades, GPS o reporte.",
                  "other: no corresponde claramente a ninguno.",
                  "El nombre o tema de un informe no lo convierte en una consulta operativa de unidad.",
                  "Devolvé solo el JSON del schema.",
                ].join(" "),
              },
              {
                role: "user",
                content: `Historial reciente:\n${threadText.slice(-1200)}\n\nMensaje actual:\n${text}`,
              },
            ],
            temperature: 0,
            max_tokens: 64,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "wara_gps_read_target",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    target: {
                      type: "string",
                      enum: ["live_unit", "platform_report", "other"],
                    },
                  },
                  required: ["target"],
                  additionalProperties: false,
                },
              },
            },
          },
          { signal },
        ),
      TURN_AI_TIMEOUT_MS,
      { stage: "gps_read_target" },
    );
    if (!response) return "other";
    const parsed = JSON.parse(response?.choices[0]?.message?.content ?? "{}") as {
      target?: "live_unit" | "platform_report" | "other";
    };
    return parsed.target ?? "other";
  } catch (err) {
    logLlmStageError("gps_read_target", err);
    return "other";
  }
}

const SYSTEM_PROMPT = `Sos el clasificador de intención de Atilio (Mesa de Ayuda Wara por WhatsApp).
Devolvé SOLO JSON válido (sin markdown):
{"executor":"unidades|odometro|certificados|mantenimiento|odoo_ticket|info_guides","confidence":0.0-1.0,"reason":"breve"}

Ejecutores (elegí UNO):

• info_guides — Preguntas INFORMATIVAS sobre CÓMO usar la plataforma Wara (manual/guía):
  módulo Opciones (agenda, contactos, perfiles, permisos, notificaciones, alertas),
  módulo Unidades (grupos, ficha expandida, MIS ATAJOS, puntos verde/azul/rojo, crear grupo),
  módulo Mantenimiento INFORMATIVO (qué es preventivo/correctivo, cómo funciona el módulo),
  módulo Transporte Público (hoja de turno, turnos, servicios/líneas, POI/etapas de recorrido,
  paradas, traza KMZ, excepciones de feriado, monitoreo de viajes / colores de línea),
  módulo Artículos (stock/remitos/inventario) aunque aún no haya guía — info_guides igual
  (el backend responde el límite de canal; NO mandes a mantenimiento/combustible),
  módulo Puntos de interés (Utilidades→POI/geocercas; Paradas TP independientes;
  etapas de servicio usan POI previos).
  NO es info_guides si piden ejecutar/registrar/programar un trámite real ni consulta GPS live.

• unidades — Consulta EN VIVO contra API Wara: listado de flota, cuántas unidades,
  GPS, ignición, voltaje, último reporte, si reporta/no reporta, offline, ubicación,
  buscar/encontrar una unidad por patente/marca/nombre (sin trámite de odómetro/horómetro activo).

• odometro — Registrar o cambiar ODÓMETRO (km) u HORÓMETRO (horas de motor): incluye
  pedir patente/prefijo para ese trámite, continuar tras listado de flota, aclarar unidad
  ("la q comienza con LWK", "patente con LWK"), dar km/horas/fecha, CONFIRMO del resumen.
  Si el hilo ya trata de cambio de km/horas, NO mandes a unidades/GPS aunque mencionen patente.

• certificados — Certificado de cobertura/monitoreo/constancia, reenvío de certificado,
  selección de unidad cuando el bot pidió unidad para certificado.

• mantenimiento — Programar o registrar mantenimiento OPERATIVO (preventivo/correctivo/service),
  dar patente/detalle/prioridad para ticket de mantenimiento, preguntas tipo "¿podés registrarlo vos?".

• odoo_ticket — Asesor humano, reclamo, ticket, soporte técnico, cerrar caso/conversación,
  consultar caso abierto, FALLA de odómetro (no marca bien, desfase) — NO registro de km,
  incidentes de acceso/admin, detalle post-derivación a asesor,
  falla MASIVA de flota sin unidad concreta ("ninguna anda", "están todas quietas",
  "ninguna reporta") — NO pedir patente.

Reglas críticas:
- Leé historial + mensaje_nuevo: la intención puede estar en el hilo (horómetro pendiente + prefijo).
- "patente con X" / "comienza con X" en contexto de odómetro/horómetro → odometro.
- Guía vs operativo: "¿cómo configuro la agenda?" → info_guides; "registrá un correctivo" → mantenimiento.
- Listado de flota → unidades (no info_guides).
- Ante duda entre odometro y unidades con trámite de km/horas en el hilo → odometro.
- confidence >= 0.85 solo si estás seguro; si dudás, bajá confidence para que el fallback regex decida.`;

export type TurnAiClassification = {
  executor: TurnExecutorId;
  confidence: number;
  reason?: string;
};

function parseAiClassification(raw: string): TurnAiClassification | null {
  try {
    const parsed = JSON.parse(raw) as {
      executor?: string;
      confidence?: number;
      reason?: string;
    };
    const executor = String(parsed.executor ?? "").trim() as TurnExecutorId;
    if (!VALID_EXECUTORS.has(executor)) return null;
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) return null;
    return { executor, confidence, reason: parsed.reason };
  } catch {
    return null;
  }
}

export async function classifyTurnWithAi(
  selectionText: string,
  threadText: string,
): Promise<TurnAiClassification | null> {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const user = [
    "historial (mensajes recientes, más abajo = más nuevo):",
    threadText.slice(-4000) || "(vacío)",
    "",
    "mensaje_nuevo:",
    selectionText.trim(),
  ].join("\n");

  const response = await withOpenAiTimeout(
    (signal) =>
      openai.chat.completions.create(
        {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
          temperature: 0.05,
          max_tokens: 120,
          response_format: { type: "json_object" },
        },
        { signal },
      ),
    TURN_AI_TIMEOUT_MS,
  );

  const content = response?.choices?.[0]?.message?.content?.trim();
  if (!content) return null;
  return parseAiClassification(content);
}

/** Guardas → IA (si habilitada) → tabla regex completa. */
export async function resolveTurnExecutor(
  selectionText: string,
  threadText: string,
  pendingAction?: import("@/lib/pendingAction").PendingActionRecord | null,
  opts?: {
    lastGuideKind?: import("@/lib/lastInfoGuideContext").LastInfoGuideKind | null;
    lastGuideCategory?: string | null;
    lastGuideReportId?: string | null;
    lastGuideArticleIds?: string[] | null;
  },
): Promise<TurnExecutorResolution> {
  const guard = classifyTurnExecutorSafetyGuards(selectionText, threadText, pendingAction);
  if (guard) {
    return { executor: guard.executor, source: "safety_guard", ruleId: guard.ruleId };
  }

  const text = selectionText.trim();
  // Falla masiva de flota: antes que forzar telemetría/unidades (anti pedir patente).
  if (looksLikeFleetWideOutageClaim(text)) {
    return {
      executor: "odoo_ticket",
      source: "safety_guard",
      ruleId: "fleet_wide_outage_advisor",
    };
  }

  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const certificadoPivot = /\b(certificado|certficado|cobertura|monitoreo|constancia)\b/.test(normalized);
  const inOdometerFlow =
    !threadOdometerRegistrationCompleted(threadText) &&
    (threadHasActiveOdometerFlow(threadText) ||
      threadAwaitingHorometerKmValue(threadText) ||
      pendingAction?.type === "odometro");
  const hardOdooIntent =
    looksLikeCustomerConversationCloseRequest(text) ||
    looksLikeHumanAdvisorRequest(text) ||
    looksLikeExplicitReclamoOrTicketRequest(text) ||
    looksLikeTechnicalSupportRequest(text);
  if (inOdometerFlow && !hardOdooIntent && !certificadoPivot) {
    return { executor: "odometro", source: "safety_guard", ruleId: "active_odometer_flow" };
  }

  if (
    (looksLikeExplicitOdometerUpdateRequest(text) || looksLikeHorometerOnlyIntent(text)) &&
    !looksLikeOperationalMaintenanceIntent(text, threadText)
  ) {
    return {
      executor: "odometro",
      source: "safety_guard",
      ruleId: "explicit_odometer_horometer_start",
    };
  }

  // Una sola interpretación KB por turno. GPS/live_unit se decide DESPUÉS,
  // para no pisar informes (p. ej. “resumen de flota”) con unidades.
  {
    const {
      interpretPlatformKnowledgeTurn,
      isFailClosedPlatformInterpret,
      isOperationalUnitInterpret,
      shouldRouteInterpretToInfoGuides,
    } = await import("@/lib/infoGuideInterpretAI");
    const { isCisternasKbEnabled } = await import("@/lib/cisternasKnowledge");
    const { isCombustibleKbEnabled } = await import("@/lib/combustibleKnowledge");
    const { isUtilidadesBloque2KbEnabled } = await import(
      "@/lib/utilidadesBloque2Knowledge"
    );
    const kbInterpret = await interpretPlatformKnowledgeTurn({
      selectionText,
      threadText,
      pendingActionType: pendingAction?.type ?? null,
      lastGuideKind: opts?.lastGuideKind ?? null,
      lastGuideCategory: opts?.lastGuideCategory ?? null,
      lastGuideReportId: opts?.lastGuideReportId ?? null,
      lastGuideArticleIds: opts?.lastGuideArticleIds ?? null,
    });
    // Fail-closed: no GPS heuristics ni classifyTurnExecutor legacy.
    if (isFailClosedPlatformInterpret(kbInterpret)) {
      return {
        executor: "info_guides",
        source: "ai",
        aiConfidence: 0,
        interpret: {
          ...kbInterpret!,
          route: "info_guides",
        },
        ruleId: "platform_kb_llm_fail_closed",
      };
    }
    if (isOperationalUnitInterpret(kbInterpret)) {
      return {
        executor: "unidades",
        source: "ai",
        aiConfidence: kbInterpret?.confidence,
        interpret: kbInterpret,
        ruleId:
          kbInterpret?.normalTarget === "operational_fuel"
            ? "operational_fuel_unit_capture"
            : "live_unit_semantic_target",
      };
    }
    if (kbInterpret?.guideKind === "informes" && shouldRouteInterpretToInfoGuides(kbInterpret)) {
      return {
        executor: "info_guides",
        source: "ai",
        aiConfidence: kbInterpret.confidence,
        interpret: kbInterpret,
        ruleId: "platform_kb_llm_interpret",
      };
    }

    const gpsReadCandidate =
      looksLikeGpsOrUnitStatusQuestion(text) ||
      looksLikeLiveUnitConsultIntent(text) ||
      shouldRouteGpsConsultToUnidades(text);
    if (
      gpsReadCandidate &&
      pendingAction?.type !== "certificados" &&
      kbInterpret?.guideKind !== "informes"
    ) {
      const readTarget = await classifyGpsReadTargetWithAi(text, threadText);
      console.info(`[gpsReadTarget] target=${readTarget}`);
      if (readTarget === "live_unit") {
        const liveInterpret = {
          route: "continue_normal" as const,
          guideKind: null,
          need: "execute" as const,
          articleIds: [] as string[],
          clarifyQuestion: null,
          executionRequest: false,
          confidence: 1,
          reason: "gps_read_semantic_target",
          category: null,
          reportId: null,
          normalTarget: "live_unit" as const,
        };
        return {
          executor: "unidades",
          source: "ai",
          aiConfidence: 1,
          interpret: liveInterpret,
          ruleId: "gps_read_semantic_target",
        };
      }
    }

    const isTp = kbInterpret?.guideKind === "transporte_publico";
    const isCs = kbInterpret?.guideKind === "cisternas" && isCisternasKbEnabled();
    const isCb = kbInterpret?.guideKind === "combustible" && isCombustibleKbEnabled();
    const isHr = kbInterpret?.guideKind === "hojas_de_ruta";
    const isPi = kbInterpret?.guideKind === "puntos_de_interes";
    const isAl = kbInterpret?.guideKind === "alertas";
    const isPn = kbInterpret?.guideKind === "paneles";
    const isOp = kbInterpret?.guideKind === "opciones";
    const isU2 =
      kbInterpret?.guideKind === "utilidades_bloque_2" &&
      isUtilidadesBloque2KbEnabled();
    const isMt = kbInterpret?.guideKind === "mantenimiento";
    const isAmbiguousClarify =
      kbInterpret?.need === "ambiguous" && Boolean(kbInterpret.clarifyQuestion);
    if (
      shouldRouteInterpretToInfoGuides(kbInterpret) &&
      (isTp ||
        isCs ||
        isCb ||
        isHr ||
        isPi ||
        isAl ||
        isPn ||
        isOp ||
        isU2 ||
        isMt ||
        isAmbiguousClarify)
    ) {
      const rulesExecutor = classifyTurnExecutor(selectionText, threadText, pendingAction);
      if (rulesExecutor === "unidades" || rulesExecutor === "info_guides" || rulesExecutor === "mantenimiento") {
        return {
          executor: "info_guides",
          source: "ai",
          aiConfidence: kbInterpret?.confidence,
          interpret: kbInterpret,
          ruleId: "platform_kb_llm_interpret",
        };
      }
    }
  }

  if (isTurnAiClassifyEnabled()) {
    const ai = await classifyTurnWithAi(selectionText, threadText);
    if (ai && ai.confidence >= MIN_CONFIDENCE) {
      return {
        executor: ai.executor,
        source: "ai",
        aiConfidence: ai.confidence,
      };
    }
  }

  const rulesExecutor = classifyTurnExecutor(selectionText, threadText, pendingAction);
  return { executor: rulesExecutor, source: "rules" };
}
