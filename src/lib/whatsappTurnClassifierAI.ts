/**
 * Clasificador semántico de turnos WhatsApp (capa IA antes del fallback regex).
 * Las guardas de seguridad y classifyTurnExecutor siguen siendo la red — la IA interpreta
 * intención + contexto cuando el mensaje es ambiguo (horómetro vs GPS, prefijos, guías).
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
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
} from "@/lib/waraApi";
import {
  looksLikeExplicitOdometerUpdateRequest,
  looksLikeHorometerOnlyIntent,
} from "@/lib/wara";

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
};

export function isTurnAiClassifyEnabled(): boolean {
  const raw = process.env.WARA_TURN_AI_CLASSIFY?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  // Desactivado por defecto: la IA de routing sumaba latencia y desvíos (GPS/Nissan
  // en medio de horómetro). Activar explícitamente con WARA_TURN_AI_CLASSIFY=true.
  return false;
}

const SYSTEM_PROMPT = `Sos el clasificador de intención de Atilio (Mesa de Ayuda Wara por WhatsApp).
Devolvé SOLO JSON válido (sin markdown):
{"executor":"unidades|odometro|certificados|mantenimiento|odoo_ticket|info_guides","confidence":0.0-1.0,"reason":"breve"}

Ejecutores (elegí UNO):

• info_guides — Preguntas INFORMATIVAS sobre CÓMO usar la plataforma Wara (manual/guía):
  módulo Opciones (agenda, contactos, perfiles, permisos, notificaciones, alertas),
  módulo Unidades (grupos, ficha expandida, MIS ATAJOS, puntos verde/azul/rojo, crear grupo),
  módulo Mantenimiento INFORMATIVO (qué es preventivo/correctivo, cómo funciona el módulo).
  NO es info_guides si piden ejecutar/registrar/programar un trámite real.

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
  incidentes de acceso/admin, detalle post-derivación a asesor.

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
): Promise<TurnExecutorResolution> {
  const guard = classifyTurnExecutorSafetyGuards(selectionText, threadText);
  if (guard) {
    return { executor: guard.executor, source: "safety_guard", ruleId: guard.ruleId };
  }

  const text = selectionText.trim();
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const certificadoPivot = /\b(certificado|certficado|cobertura|monitoreo|constancia)\b/.test(normalized);
  const inOdometerFlow =
    !threadOdometerRegistrationCompleted(threadText) &&
    (threadHasActiveOdometerFlow(threadText) || threadAwaitingHorometerKmValue(threadText));
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

  const rulesExecutor = classifyTurnExecutor(selectionText, threadText);
  return { executor: rulesExecutor, source: "rules" };
}
