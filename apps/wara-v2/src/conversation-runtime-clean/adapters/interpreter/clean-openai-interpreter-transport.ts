import { CLEAN_CAPABILITY_CATALOG } from "../../core/authorization/capability-catalog.js";
import type { ConversationStateClean } from "../../core/types/state.js";
import { CLEAN_INTERPRETER_PROMPT_VERSION } from "./versions.js";
import type { StableInterpreterTransport } from "./stable-interpreter-adapter.js";

export type CleanInterpreterClock = Readonly<{ now(): Date }>;
type AuthorizedOpenAiFetch = (url: string, input: Readonly<{ method: string; headers: Readonly<Record<string, string>>; body: string; timeoutMs: number }>) => Promise<Readonly<{ status: number; text: string }>>;

const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";

function timeZone(env: NodeJS.ProcessEnv): string {
  const candidate = env.WARA_CLEAN_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    throw new Error("invalid_clean_time_zone");
  }
}

function timeoutMs(env: NodeJS.ProcessEnv): number {
  const value = Number(env.WARA_CLEAN_LLM_TIMEOUT_MS ?? "25000");
  return Number.isFinite(value) && value > 0 ? Math.min(value, 60_000) : 25_000;
}

function required(env: NodeJS.ProcessEnv, key: "OPENAI_API_KEY" | "WARA_CLEAN_OPENAI_MODEL"): string {
  const value = env[key]?.trim() ?? "";
  if (!value) throw new Error(`missing_${key.toLowerCase()}`);
  return value;
}

const SERVICE_CATALOG = CLEAN_CAPABILITY_CATALOG
  .map((capability) => `${capability.name} (${capability.kind}, ${capability.task})`)
  .join("\n");

const PRIMITIVE_VALUE_SCHEMA = {
  anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
} as const;

export const CLEAN_INTERPRETER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "userAct", "relation", "normalizedMeaning", "requests", "references", "suppliedFields",
    "corrections", "answersExpectedField", "confidence", "ambiguity", "confirmation",
  ],
  properties: {
    userAct: { enum: ["greeting", "request", "answer", "question", "correction", "confirmation", "cancellation", "rejection", "acknowledgement", "unknown"] },
    relation: { enum: ["standalone", "answer_expected", "continue", "side_question", "switch", "pause", "resume", "replace", "cancel", "confirm", "ambiguous"] },
    normalizedMeaning: { type: "string" },
    requests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["serviceId", "domain", "goal", "entities", "operationHint"],
        properties: {
          serviceId: { enum: CLEAN_CAPABILITY_CATALOG.map((capability) => capability.name) },
          domain: { enum: ["company", "unit_query", "gps", "odometer", "hourmeter", "maintenance", "certificate", "knowledge", "human_handoff", "conversation_assignment", "ticket", "attachment", "conversation"] },
          goal: { type: "string" },
          entities: { type: "object", additionalProperties: false, properties: {}, required: [] },
          operationHint: { enum: ["conversation", "read", "write_prepare", "write_commit", "handoff"] },
        },
      },
    },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "expression", "source", "index", "unitReferenceKind"],
        properties: {
          type: { enum: ["company", "unit", "listing_index"] },
          expression: { type: "string" },
          source: { enum: ["message", "active", "previous", "last_presented", "explicit"] },
          index: { type: ["integer", "null"] },
          unitReferenceKind: { enum: ["internal_code", "plate", "name", "brand", "model", "any", null] },
        },
      },
    },
    suppliedFields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value"],
        properties: {
          field: { enum: ["company", "unit", "value", "date", "time", "confirmation", "clarification", "free_text"] },
          value: PRIMITIVE_VALUE_SCHEMA,
        },
      },
    },
    corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value"],
        properties: { field: { type: "string" }, value: PRIMITIVE_VALUE_SCHEMA },
      },
    },
    answersExpectedField: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    ambiguity: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["reason", "alternatives", "clarificationQuestion"],
          properties: {
            reason: { type: "string" },
            alternatives: { type: "array", items: { type: "string" } },
            clarificationQuestion: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    confirmation: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["intended", "containsCorrections"],
          properties: { intended: { type: "boolean" }, containsCorrections: { type: "boolean" } },
        },
        { type: "null" },
      ],
    },
  },
} as const;

export const CLEAN_INTERPRETER_SYSTEM_PROMPT = `Sos el Interpreter de Runtime Clean de WARA. Sos la única autoridad que puede leer el mensaje libre y producir significado semántico.

Devolvé solamente JSON con este contrato exacto (el transporte lo exige mediante JSON Schema estricto):
- userAct: greeting|request|answer|question|correction|confirmation|cancellation|rejection|acknowledgement|unknown
- relation: standalone|answer_expected|continue|side_question|switch|pause|resume|replace|cancel|confirm|ambiguous
- normalizedMeaning: significado actual conciso
- requests: [{serviceId, domain, goal, entities: {}, operationHint}]
- references: [{type, expression, source, index, unitReferenceKind}]
- suppliedFields: [{field, value}]
- corrections: [{field, value}]
- answersExpectedField: boolean
- confidence: número 0..1
- ambiguity: {reason, alternatives, clarificationQuestion} | null
- confirmation: {intended, containsCorrections} | null

Reglas de autoridad:
1. No inventes empresas, unidades, valores, fechas, resultados ni operaciones.
2. El mensaje actual manda. expectedInput es contexto, no una orden de clasificación.
3. Una pregunta lateral conserva el trámite. Un cambio explícito de servicio usa switch o replace. Un abandono explícito usa cancellation+cancel.
4. Una corrección de unidad conserva el mismo trámite, emite una referencia unit tipada y usa userAct=correction; nunca confirma una operación previa.
5. Confirmación y cancelación son actos distintos. Una despedida, agradecimiento o ausencia de negación nunca confirma.
5a. entities siempre es {}. Todo significado variable va únicamente en references, suppliedFields o corrections.
5b. Si expectedInput pide unit, company, value, date o time y el usuario responde ese dato, usá userAct=answer, relation=answer_expected y answersExpectedField=true, salvo que sea una corrección o cancelación explícita. Emití la referencia o suppliedField tipado correspondiente. No abras unit.search ni cambies de servicio solo por recibir el dato esperado: el Controller continuará la tarea enfocada.
5c. references contiene exclusivamente referencias reales de empresa o unidad. Fechas, horas, valores y palabras de confirmación van solo en suppliedFields/corrections/confirmation. Nunca copies una fecha, hora o valor como reference.type=unit.
5d. Si el usuario reemplaza una unidad dentro de la tarea activa, usá userAct=correction, relation=continue y una reference unit tipada. No abras una tarea unit_query independiente.

Fechas y horas:
6. Normalizá fechas a YYYY-MM-DD y horas a HH:mm de 24 horas usando referenceInstant y timeZone del payload.
7. Podés devolver varios suppliedFields en un turno. Si el usuario entrega fecha y hora juntas, devolvé ambos campos.
8. Interpretá expresiones relativas respecto de referenceInstant/timeZone: hoy es el día local, ayer es el día local anterior y "jueves pasado" es el jueves inmediatamente anterior. En una lectura histórica de odómetro/horómetro, un día de semana sin modificador (por ejemplo "el lunes") es la ocurrencia más reciente que no sea futura; fuera de ese contexto, si pasado/futuro no queda determinado, pedí aclaración. Una hora con período explícito se normaliza (mañana=AM, tarde/noche=PM según el significado ordinario).
9. Si una hora de 1 a 12 no tiene período ni contexto suficiente, no inventes AM/PM: relation=ambiguous, no emitas suppliedField time y pedí aclaración. “En punto” fija los minutos en 00 pero no define AM/PM.

Unidades:
10. Toda identificación real de unidad usa reference.type=unit y conserva expression sin convertirla en patente. No generes una referencia de unidad a partir de un valor, una fecha o una hora.
11. unitReferenceKind debe ser internal_code, plate, name, brand, model o any. Un identificador compuesto solo por dígitos presentado como número/código de unidad es internal_code, no plate. source es message para referencias presentes en el mensaje actual; index y unitReferenceKind son null cuando no aplican.
12. Para búsqueda/listado usá unit.search. Para estado, reporte, GPS, ubicación o posición usá gps.get_status. Incluí la referencia de unidad si está presente.
13. Marca y modelo son criterios de búsqueda válidos. Si hay varias coincidencias, la resolución posterior pedirá selección; no elijas una.

Servicios permitidos:
${SERVICE_CATALOG}`;

function payload(input: { message: string; state: ConversationStateClean }, clock: CleanInterpreterClock, zone: string) {
  const focused = input.state.tasks.find((task) => task.id === input.state.focusedTaskId) ?? null;
  return {
    promptVersion: CLEAN_INTERPRETER_PROMPT_VERSION,
    message: input.message,
    referenceInstant: clock.now().toISOString(),
    timeZone: zone,
    context: {
      company: input.state.company ? { id: input.state.company.id, name: input.state.company.name } : null,
      unit: input.state.unit ? { id: input.state.unit.id, label: input.state.unit.label, code: input.state.unit.code ?? null, plate: input.state.unit.plate ?? null } : null,
      focusedTask: focused ? { type: focused.type, status: focused.status, collectedFields: focused.collectedFields } : null,
      expectedInput: input.state.expectedInput,
      hasPendingOperation: Boolean(input.state.pendingOperation),
      pendingResolutionType: input.state.pendingResolution?.entityType ?? null,
      lastListing: input.state.lastListing ? { kind: input.state.lastListing.kind, items: input.state.lastListing.items } : null,
    },
  };
}

export class CleanOpenAiInterpreterTransport implements StableInterpreterTransport {
  constructor(private readonly env: NodeJS.ProcessEnv, private readonly clock: CleanInterpreterClock = { now: () => new Date() }) {}

  async call(input: { message: string; state: ConversationStateClean }): Promise<unknown> {
    const networkModulePath: string = "../../../llm/network.js";
    const flagsModulePath: string = "../../../llm/flags.js";
    const network = await import(networkModulePath) as { authorizedOpenAiFetch?: AuthorizedOpenAiFetch };
    const flags = await import(flagsModulePath) as { FIXED_OPENAI_ENDPOINT?: string };
    if (!network.authorizedOpenAiFetch || !flags.FIXED_OPENAI_ENDPOINT) throw new Error("clean_interpreter_authorized_transport_unavailable");
    const response = await network.authorizedOpenAiFetch(flags.FIXED_OPENAI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${required(this.env, "OPENAI_API_KEY")}` },
      body: JSON.stringify({
        model: required(this.env, "WARA_CLEAN_OPENAI_MODEL"),
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "wara_clean_turn_interpretation",
            description: "Meaning of one WARA Runtime Clean user turn. No operational execution.",
            strict: true,
            schema: CLEAN_INTERPRETER_JSON_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: CLEAN_INTERPRETER_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload(input, this.clock, timeZone(this.env))) },
        ],
      }),
      timeoutMs: timeoutMs(this.env),
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`clean_interpreter_http_${response.status}`);
    const body = JSON.parse(response.text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content?.trim()) throw new Error("clean_interpreter_empty_response");
    return JSON.parse(content) as unknown;
  }
}

export const cleanInterpreterTemporalDefaults = Object.freeze({ timeZone: DEFAULT_TIME_ZONE });
