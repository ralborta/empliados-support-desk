/**
 * Capa de comprensión en lenguaje natural del mensaje del usuario.
 *
 * Principio: TODO mensaje de cliente pasa por la IA (interpretar intención + hilo).
 * Las reglas operativas NO hablan solas: solo EJECUTAN cuando la intención ya está clara
 * (CONFIRMO de trámite, km, odómetro estructurado, etc.).
 *
 * Si la IA duda → pregunta. Si falla OpenAI → fallback a reglas (no bloquea el turno).
 *
 * Activar/desactivar: WARA_UTTERANCE_UNDERSTANDING (default: encendido).
 */
import OpenAI from "openai";
import { OPENAI_DEFAULT_TIMEOUT_MS, withOpenAiTimeout } from "@/lib/openaiTimeout";
import {
  hasPendingCertificateUnitRequest,
  hasPendingMaintenancePlateRequest,
  threadHasActiveOdometerFlow,
} from "@/lib/wara";
import { isOperationalMeterCollectionMessage } from "@/lib/tramiteMeterPrecedence";
import {
  extractMovilIdFromUnitMessage,
  inferNumericExpectedFieldForThread,
  isMaintenancePlateSelectionMessage,
  isOdometerPlateSelectionMessage,
} from "@/lib/waraUnitIntent";
import {
  buildAggregateFleetComparisonLimitReply,
  classifyFleetQueryKind,
} from "@/lib/fleetQueryKind";
import {
  detectServiceIntentInMessage,
  extractEmbeddedNumericReferences,
  resolveUnitReferenceFromMessage,
} from "@/lib/unitReferenceParser";
import { looksLikeExplicitCapabilityMenuRequest } from "@/lib/waraApi";

const UNDERSTAND_TIMEOUT_MS = Math.min(OPENAI_DEFAULT_TIMEOUT_MS, 8_000);
const MIN_CONFIDENCE = 0.72;
/** Mensajes más largos igual se interpretan; el hilo ya trae contexto. */
const MAX_INTERPRET_CHARS = 220;

export type UtteranceReferent =
  | "vehicle_unit"
  | "admin_number"
  | "menu_option"
  | "confirmation"
  | "odometer_data"
  | "new_request"
  | "other"
  | "unclear";

/** Cómo el cliente identifica la unidad (razonado por IA, no por regex de frases). */
export type UnitRefKind =
  | "full_plate"
  | "prefix"
  | "suffix"
  | "brand"
  | "unit_name"
  | "none";

export type UnitRef = {
  kind: UnitRefKind;
  /** Valor usable: patente/prefijo/sufijo compacto, marca o nombre. null si kind=none. */
  value: string | null;
};

export type UtteranceUnderstanding = {
  referent: UtteranceReferent;
  confidence: number;
  clarifyQuestion: string | null;
  reason?: string;
  unitRef?: UnitRef;
  /**
   * Acción estructurada (autoridad semántica). Reconocer una unidad (referent)
   * NO implica por sí sola consulta GPS ni escritura.
   */
  action?: UtteranceAction;
};

/** Acción conversacional estructurada — no se infiere solo del referent. */
export type UtteranceAction =
  | "unit_status_read"
  | "unit_reference"
  | "unit_correction"
  | "new_write"
  | "continue_field"
  | "none";

const VALID_ACTIONS: UtteranceAction[] = [
  "unit_status_read",
  "unit_reference",
  "unit_correction",
  "new_write",
  "continue_field",
  "none",
];

export function isUtteranceUnderstandingEnabled(): boolean {
  const raw = process.env.WARA_UTTERANCE_UNDERSTANDING?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

const SYSTEM_PROMPT = `Sos el intérprete de intención de Atilio (Mesa de Ayuda Wara por WhatsApp).
Tu trabajo: RAZONAR a qué se refiere el mensaje_nuevo dado el historial (sobre todo la última pregunta del bot), EXTRAER la referencia a unidad si la hay, y declarar la ACCIÓN estructurada.
La ÚLTIMA pregunta o pedido del bot en el historial es MANDATORIO: si pidió unidad/patente/interno/código, el mensaje_nuevo casi siempre responde ESO (no reinterpretes como caso/ticket salvo que el cliente lo diga explícito).
NO inventes patentes, km ni trámites. Si dudás, pedí aclaración.
Tolerá errores de escritura / typos / abreviaturas / desorden: interpretá la intención real, no el texto literal.
Coloquial rioplatense (solo INTERPRETAR, no imitar al responder): porfa/porfis, dale nomás, joya, genial, barbaro, obvio, claro, avanzá/avanzame (typos: vancame, bamcame), metele, hacelo, registralo. "bancame" = esperá/aguardá (NO es confirmación). "gracias"/"genial" solos pueden ser cierre o visto bueno según contexto.

Devolvé SOLO JSON válido:
{"referent":"vehicle_unit|admin_number|menu_option|confirmation|odometer_data|new_request|other|unclear","action":"unit_status_read|unit_reference|unit_correction|new_write|continue_field|none","confidence":0.0-1.0,"clarify_question":string|null,"unit_ref":{"kind":"full_plate|prefix|suffix|brand|unit_name|none","value":string|null},"reason":"breve"}

Significado de referent:
- vehicle_unit — indica o busca una UNIDAD (patente, fragmento de matrícula, marca, nombre interno, interno/número de interno de flota).
- admin_number — número administrativo (caso/ticket/teléfono de gestión), NO matrícula ni interno de unidad.
- menu_option — opción de menú (empresa 1/2, sí/no de lista).
- confirmation — confirma o rechaza (CONFIRMO, dale, ok, no, gracias como cierre).
- odometer_data — km/hs/fecha para odómetro/horómetro en curso.
- new_request — trámite o tema nuevo.
- other — saludo/chitchat entendible.
- unclear — no se entiende con seguridad.

Significado de action (OBLIGATORIO; independiente de referent):
- unit_status_read — el cliente pide ESTADO/GPS/ubicación/reporte/ignición de una unidad (incluye typos de esas palabras de pedido). SOLO con esta action se autoriza una consulta de telemetría.
- unit_reference — solo nombra o selecciona una unidad SIN pedir estado/GPS (ej. "900121", "la NKL 952", "M900-100"). NO autoriza GPS.
- unit_correction — corrige/rechaza la unidad ("no era esa", "es la otra", "cambiame de unidad") SIN pedir telemetría.
- new_write — inicia o pide otro trámite de escritura (certificado, mantenimiento, otro odómetro/horómetro).
- continue_field — aporta el dato que el bot ya pidió (km, horas, fecha, patente del trámite en curso).
- none — ninguna de las anteriores.

IMPORTANTE: referent=vehicle_unit + unit_ref NO implica action=unit_status_read. Si solo hay entidad sin pedido de estado, usá unit_reference.
Si el mensaje parece un typo o variante de ESTADO/GPS/UBICACIÓN/REPORTE + referencia de unidad (ej. "estao de la NKL", "ubicaion 900100", "reportee el interno") → action=unit_status_read SIEMPRE, aunque el hilo esté pidiendo horas/km del medidor. NO uses continue_field ni unit_reference para un pedido de estado mal escrito.
Heurística tipográfica (general): si la primera palabra del mensaje está a 1 letra de distancia de "estado"/"gps"/"ubicacion"/"reporte" (cambio, omisión o inserción) y el resto trae patente/interno/código, es unit_status_read aunque esa palabra exista en el diccionario con otro significado. El typo no convierte la consulta en mera referencia de unidad.

unit_ref (OBLIGATORIO razonarlo siempre):
- full_plate — matrícula completa usable (value: letras+dígitos compactos, ej. "AD427MC").
- prefix — el cliente apunta al COMIENZO de la patente (empieza/arranca/inicia/la que va con…), aunque el verbo o la frase estén mal escritos. value: solo las 2–3 letras/dígitos del prefijo (ej. "AD", "OST"), NUNCA la frase tipográfica completa.
- suffix — apunta al FINAL de la patente (termina/finaliza en…). value: sufijo corto.
- brand — marca o etiqueta de flota (Nissan, Altamiranda…). value: texto a buscar.
- unit_name — nombre/código interno (M300-112, 300-112, interno 900079, número de interno 900079) o apellido/etiqueta listada. value: ese texto o dígitos.
- none — no hay referencia a unidad en el mensaje_nuevo.

Principios (generales):
- COMPARACIÓN / RANKING entre unidades de la flota ("cuál unidad tiene más/menos/peor/mejor…", "la que más lleva sin reportar") → referent=new_request, clarify_question=null. NO pidas patente para "identificar cuál gana el ranking": eso NO se puede resolver unidad por unidad con una sola chapa.
- Si el cliente pide LISTADO / FLOTA / TODAS las unidades ("listame", "dame el listado") → new_request, unit_ref none. NO pidas matrícula: quieren ver la lista.
- Si el cliente pide estado/GPS por nombre o etiqueta que aparece en la flota (persona, chofer, alias listado) → vehicle_unit + action=unit_status_read + unit_ref brand o unit_name. NUNCA pidas la matrícula: buscá por ese texto.
- Si el hilo pide patente/prefijo/unidad/interno/código y el mensaje parece un intento de identificarla → vehicle_unit + action=unit_reference|continue_field + unit_ref concreto. No preguntes si el texto crudo tipográfico "es la patente".
- Si la última pregunta del bot pide la unidad (patente, interno, código) y el cliente manda solo 5–7 dígitos (ej. 900079, 600088) → vehicle_unit + action=continue_field|unit_reference + unit_name con esos dígitos. NO admin_number.
- "interno" / "número de interno" / "nro de interno" en contexto de flota/odómetro/certificado/GPS = identificador de UNIDAD (vehicle_unit), no ticket de caso.
- Si el hilo YA tiene una unidad activa/confirmada (el bot dijo "Con la unidad X…" o "contame qué problema") y el cliente pide estado/reporte/GPS sin repetir la patente ("Quiero el estado", "el reporte", "¿cómo está?") → vehicle_unit, action=unit_status_read, unit_ref.none, clarify_question null. NUNCA pidas la matrícula de nuevo: usá la del hilo.
- Matrícula reconocible (formato AR) → full_plate, no admin_number.
- "NRO"/"N°"/"numero" sueltos → admin_number y unit_ref.none, SALVO que el cliente los marque explícitamente como parte de patente/prefijo/interno de unidad.
- Token de 2–3 letras solo es prefix/full_plate si el contexto es buscar/elegir unidad.
- Si vehicle_unit pero sin dato usable → unit_ref.kind=none y pedí la chapa en clarify_question.
- confidence < 0.75 → preferí unclear.
- clarify_question: español rioplatense, corto, sin emojis. null si no hace falta.`;

const FALLBACK_CLARIFY =
  "No te seguí del todo. ¿Me estás pasando una patente o parte de ella, o un número de otra cosa (caso, interno, opción)?";

/**
 * Casi todo mensaje va a la IA. Se excluye vacío / demasiado largo y turnos donde
 * las reglas operativas del trámite activo ya definen la respuesta (odómetro,
 * certificado, mantenimiento esperando unidad).
 */
export function shouldInterpretAmbiguousUtterance(
  selectionText: string,
  threadText = "",
): boolean {
  const text = selectionText.trim();
  if (!text) return false;
  if (text.length > MAX_INTERPRET_CHARS) return false;

  if (looksLikeExplicitCapabilityMenuRequest(text)) return false;
  if (classifyFleetQueryKind(text).kind === "aggregate_comparison") return false;
  if (classifyFleetQueryKind(text).kind === "fleet_list") return false;

  // Trámite de medidor activo: solo omitir semántica si el mensaje ya satisface
  // el campo esperado (parser operativo). Si no, permitir interpretación (typos,
  // consultas laterales, etc.) sin hardcodear frases.
  if (
    threadHasActiveOdometerFlow(threadText) &&
    isOperationalMeterCollectionMessage(text, threadText)
  ) {
    return false;
  }

  const expectedField = inferNumericExpectedFieldForThread(threadText);
  const resolution = resolveUnitReferenceFromMessage({
    rawText: text,
    serviceIntent: detectServiceIntentInMessage(text),
    expectedField,
  });
  if (resolution.unitMovilId != null) return false;
  if (
    detectServiceIntentInMessage(text) !== "none" &&
    extractEmbeddedNumericReferences(text).some((c) => c.source === "embedded")
  ) {
    return false;
  }

  // Certificado o mantenimiento esperando unidad → continuar recolección, no reinterpretar.
  if (
    hasPendingCertificateUnitRequest(threadText) &&
    (extractMovilIdFromUnitMessage(text, { threadText }) != null ||
      isOdometerPlateSelectionMessage(text))
  ) {
    return false;
  }
  if (
    hasPendingMaintenancePlateRequest(threadText) &&
    (extractMovilIdFromUnitMessage(text, { threadText }) != null ||
      isMaintenancePlateSelectionMessage(text))
  ) {
    return false;
  }

  return true;
}

function parseUnitRef(raw: unknown): UnitRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as { kind?: string; value?: string | null };
  const kind = String(o.kind ?? "none").trim() as UnitRefKind;
  const valid: UnitRefKind[] = [
    "full_plate",
    "prefix",
    "suffix",
    "brand",
    "unit_name",
    "none",
  ];
  if (!valid.includes(kind)) return { kind: "none", value: null };
  if (kind === "none") return { kind: "none", value: null };
  const valueRaw = typeof o.value === "string" ? o.value.trim() : "";
  if (!valueRaw) return { kind: "none", value: null };
  // Prefijo/sufijo/patente: compactar; marca/nombre: conservar espacios simples.
  const value =
    kind === "brand" || kind === "unit_name"
      ? valueRaw.replace(/\s+/g, " ").slice(0, 40)
      : valueRaw.replace(/[\s\-_.]+/g, "").toUpperCase().slice(0, 12);
  if (!value) return { kind: "none", value: null };
  return { kind, value };
}

function parseUnderstanding(raw: string): UtteranceUnderstanding | null {
  try {
    const parsed = JSON.parse(raw) as {
      referent?: string;
      action?: string;
      confidence?: number;
      clarify_question?: string | null;
      reason?: string;
      unit_ref?: unknown;
    };
    const referent = String(parsed.referent ?? "").trim() as UtteranceReferent;
    const valid: UtteranceReferent[] = [
      "vehicle_unit",
      "admin_number",
      "menu_option",
      "confirmation",
      "odometer_data",
      "new_request",
      "other",
      "unclear",
    ];
    if (!valid.includes(referent)) return null;
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) return null;
    const clarify =
      typeof parsed.clarify_question === "string" && parsed.clarify_question.trim()
        ? parsed.clarify_question.trim().slice(0, 280)
        : null;
    const actionRaw = String(parsed.action ?? "").trim() as UtteranceAction;
    const action = VALID_ACTIONS.includes(actionRaw) ? actionRaw : "none";
    return {
      referent,
      confidence: Math.max(0, Math.min(1, confidence)),
      clarifyQuestion: clarify,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      unitRef: parseUnitRef(parsed.unit_ref),
      action,
    };
  } catch {
    return null;
  }
}

/**
 * Riesgo de acción desde understanding estructurado.
 * vehicle_unit solo NO autoriza read: hace falta action=unit_status_read.
 */
export function actionRiskFromUnderstanding(
  understanding: UtteranceUnderstanding | null,
): "read" | "write" | null {
  if (!understanding || understanding.confidence < MIN_CONFIDENCE) return null;
  if (understanding.action === "unit_status_read") return "read";
  if (understanding.action === "new_write") return "write";
  return null;
}

/** Unidad reconocida sin acción de lectura/escritura clara → aclarar, no ejecutar GPS. */
export function shouldClarifyUnitWithoutStatusAction(
  understanding: UtteranceUnderstanding | null,
): boolean {
  if (!understanding || understanding.confidence < MIN_CONFIDENCE) return false;
  if (understanding.referent !== "vehicle_unit") return false;
  if (understanding.action === "unit_status_read") return false;
  if (understanding.action === "new_write") return false;
  if (understanding.action === "continue_field") return false;
  const ref = understanding.unitRef;
  if (!ref || ref.kind === "none" || !ref.value) return false;
  return (
    understanding.action === "unit_reference" ||
    understanding.action === "unit_correction" ||
    understanding.action === "none" ||
    understanding.action == null
  );
}

export function buildUnitReferenceClarifyReply(
  understanding: UtteranceUnderstanding | null,
): string {
  const label = understanding?.unitRef?.value?.trim();
  if (understanding?.action === "unit_correction") {
    return label
      ? `Entendido, no era esa. ¿Querés el *estado/GPS* de ${label}, o seguimos con el trámite en curso?`
      : "Entendido. ¿Querés consultar el *estado/GPS* de otra unidad, o seguimos con el trámite en curso?";
  }
  return label
    ? `Tomé la referencia *${label}*. ¿Querés el *estado/GPS* de esa unidad, o es el dato para el trámite en curso?`
    : "Tomé una referencia de unidad. ¿Querés el *estado/GPS*, o es el dato para el trámite en curso?";
}

export async function understandUserUtterance(
  selectionText: string,
  threadText: string,
): Promise<UtteranceUnderstanding | null> {
  if (!isUtteranceUnderstandingEnabled()) return null;
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  if (!shouldInterpretAmbiguousUtterance(selectionText, threadText)) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const user = [
      "historial (más abajo = más nuevo):",
      threadText.slice(-3500) || "(vacío)",
      "",
      "mensaje_nuevo:",
      selectionText.trim(),
    ].join("\n");

    const response = await withOpenAiTimeout(
      (signal) =>
        openai.chat.completions.create(
          {
            model: process.env.WARA_UTTERANCE_MODEL?.trim() || "gpt-4o-mini",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: user },
            ],
            temperature: 0.1,
            max_tokens: 220,
            response_format: { type: "json_object" },
          },
          { signal },
        ),
      UNDERSTAND_TIMEOUT_MS,
    );

    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    return parseUnderstanding(content);
  } catch (err) {
    console.warn(
      "[utteranceUnderstanding] falló; se sigue con reglas:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Si hace falta aclarar antes de ejecutar reglas. No aclara confirmaciones /
 * menú / trámites claros — eso lo ejecutan las reglas operativas.
 */
export function clarificationFromUnderstanding(
  understanding: UtteranceUnderstanding | null,
  rawText?: string,
): string | null {
  if (!understanding) return null;

  const lowConfidence = understanding.confidence < MIN_CONFIDENCE;
  if (shouldAnswerOpenCaseFromUnderstanding(understanding, rawText ?? "")) {
    return null;
  }

  // Intenciones operativas claras → no interrumpir con pregunta.
  if (
    !lowConfidence &&
    (understanding.referent === "confirmation" ||
      understanding.referent === "menu_option" ||
      understanding.referent === "odometer_data" ||
      understanding.referent === "new_request" ||
      understanding.referent === "other" ||
      understanding.referent === "vehicle_unit")
  ) {
    return null;
  }

  const needsClarify =
    understanding.referent === "unclear" ||
    understanding.referent === "admin_number" ||
    lowConfidence;

  if (!needsClarify) return null;

  if (classifyFleetQueryKind(rawText ?? "").kind === "aggregate_comparison") {
    return buildAggregateFleetComparisonLimitReply();
  }

  if (understanding.referent === "admin_number") {
    return (
      understanding.clarifyQuestion?.trim() ||
      "¿A qué número te referís: caso/ticket, interno, o parte de una patente?"
    );
  }

  return understanding.clarifyQuestion?.trim() || FALLBACK_CLARIFY;
}

/**
 * La IA dijo número admin + mensaje/hilo de caso → responder caso abierto.
 */
export function shouldAnswerOpenCaseFromUnderstanding(
  understanding: UtteranceUnderstanding | null,
  rawText: string,
  threadText = "",
): boolean {
  if (!understanding) return false;
  if (understanding.confidence < MIN_CONFIDENCE) return false;
  if (understanding.referent !== "admin_number") return false;

  const text = rawText.trim();
  if (!text) return false;

  const mentionsCaseOrTicket =
    /\b(ticket|caso|reclamo|gesti[oó]n)\b/i.test(text);
  const threadHasCaseCue =
    /caso abierto|#\d+|gener[eé] un caso|registr[eé] la consulta en el caso/i.test(
      threadText.slice(-4000),
    );

  if (mentionsCaseOrTicket) return true;
  if (threadHasCaseCue && text.split(/\s+/).length >= 3) return true;
  return false;
}

/** ¿Seguir tratando el mensaje como búsqueda/selección de unidad según la IA? */
export function shouldProceedAsVehicleUnit(
  understanding: UtteranceUnderstanding | null,
): boolean {
  if (!understanding) return true; // sin IA → reglas como siempre
  if (understanding.confidence < MIN_CONFIDENCE) return false;
  return understanding.referent === "vehicle_unit";
}

/**
 * Hint de búsqueda en flota razonado por IA (no regex de frases).
 * Las reglas operativas ejecutan con este valor; no hace falta matchear el typo.
 */
export function unitSearchHintFromUnderstanding(
  understanding: UtteranceUnderstanding | null,
): { platePrefix?: string; plate?: string; brand?: string; unitName?: string } | null {
  if (!understanding || understanding.confidence < MIN_CONFIDENCE) return null;
  const ref = understanding.unitRef;
  if (!ref || ref.kind === "none" || !ref.value) return null;
  if (understanding.referent !== "vehicle_unit" && understanding.referent !== "unclear") {
    // Si la IA extrajo unit_ref con confianza pero clasificó otro referent, igual usamos el hint
    // solo cuando el kind es claramente de unidad.
  }
  switch (ref.kind) {
    case "prefix":
      if (/^[A-Z0-9]{2,4}$/.test(ref.value)) return { platePrefix: ref.value };
      return null;
    case "full_plate":
      if (ref.value.length >= 5) return { plate: ref.value };
      if (/^[A-Z0-9]{2,4}$/.test(ref.value)) return { platePrefix: ref.value };
      return null;
    case "brand":
      return { brand: ref.value };
    case "unit_name":
      return { unitName: ref.value };
    case "suffix":
      // Sufijo se resuelve en reglas vía texto; no forzamos prefix.
      return null;
    default:
      return null;
  }
}

/** IA razonó una referencia usable a unidad → ir a flota (ejecutar), no aclarar ni chitchat. */
export function shouldForceUnidadesFromUnderstanding(
  understanding: UtteranceUnderstanding | null,
): boolean {
  if (!understanding || understanding.confidence < MIN_CONFIDENCE) return false;
  if (understanding.referent !== "vehicle_unit") return false;
  return unitSearchHintFromUnderstanding(understanding) != null;
}
