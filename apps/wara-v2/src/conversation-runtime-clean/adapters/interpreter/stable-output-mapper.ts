import { getCleanCapability } from "../../core/authorization/capability-catalog.js";
import type { EntityReference, ExpectedField, OperationKind, SuppliedField, TaskType, ThreadRelation, TurnInterpretation, UnitReferenceKind, UserAct } from "../../core/types/interpretation.js";
import type { ConversationStateClean } from "../../core/types/state.js";

const USER_ACTS: ReadonlySet<string> = new Set<UserAct>(["greeting", "request", "answer", "question", "correction", "confirmation", "cancellation", "rejection", "acknowledgement", "unknown"]);
const RELATIONS: ReadonlySet<string> = new Set<ThreadRelation>(["standalone", "answer_expected", "continue", "side_question", "switch", "pause", "resume", "replace", "cancel", "confirm", "ambiguous"]);
const SOURCES: ReadonlySet<string> = new Set(["message", "active", "previous", "last_presented", "explicit"]);
const EXPECTED_FIELDS: ReadonlySet<string> = new Set<ExpectedField>(["company", "unit", "value", "date", "time", "confirmation", "clarification", "free_text"]);
const UNIT_REFERENCE_KINDS: ReadonlySet<string> = new Set<UnitReferenceKind>(["internal_code", "plate", "name", "brand", "model", "any"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function array(value: unknown): unknown[] | null { return Array.isArray(value) ? value : null; }
function parseRaw(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try { return record(JSON.parse(raw)); } catch { return null; }
  }
  return record(raw);
}
export function deepFreezeInterpretationValue<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (!value || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && "value" in descriptor) deepFreezeInterpretationValue(descriptor.value, seen);
  }
  if (!Object.isFrozen(object)) Object.freeze(object);
  return value;
}
function detachInterpretationValue<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (!value || typeof value !== "object") return value;
  const object = value as object;
  const existing = seen.get(object);
  if (existing) return existing as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(object, copy);
    for (const child of value) copy.push(detachInterpretationValue(child, seen));
    return copy as T;
  }
  const copy: Record<PropertyKey, unknown> = {};
  seen.set(object, copy);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor?.enumerable && "value" in descriptor) copy[key] = detachInterpretationValue(descriptor.value, seen);
  }
  return copy as T;
}
function operationKind(serviceId: string, hint: unknown): OperationKind | null {
  const definition = getCleanCapability(serviceId);
  if (definition) return definition.kind;
  if (hint === "conversation") return "conversation";
  if (hint === "read") return "read";
  if (hint === "handoff") return "handoff";
  return null;
}
function taskType(serviceId: string, domain: unknown): TaskType | "conversation" | null {
  const definition = getCleanCapability(serviceId);
  if (definition) return definition.task;
  return domain === "conversation" ? "conversation" : null;
}
function mapReferences(raw: unknown[]): EntityReference[] | null {
  const references: EntityReference[] = [];
  for (const value of raw) {
    const item = record(value);
    if (!item || typeof item.expression !== "string") return null;
    const source = item.source ?? "message";
    if (typeof source !== "string" || !SOURCES.has(source)) return null;
    const type = item.type === "index" ? "listing_index" : item.type;
    if (type !== "company" && type !== "unit" && type !== "listing_index") return null;
    if (item.index !== undefined && item.index !== null && (!Number.isInteger(item.index) || Number(item.index) < 1)) return null;
    if (item.unitReferenceKind !== undefined && item.unitReferenceKind !== null
      && (type !== "unit" || typeof item.unitReferenceKind !== "string" || !UNIT_REFERENCE_KINDS.has(item.unitReferenceKind))) return null;
    references.push({ type, expression: item.expression, source: source as EntityReference["source"], ...(item.index === undefined || item.index === null ? {} : { index: Number(item.index) }),
      ...(item.unitReferenceKind === undefined || item.unitReferenceKind === null ? {} : { unitReferenceKind: item.unitReferenceKind as UnitReferenceKind }) });
  }
  return references;
}
function digits(value: string, start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}
function validDate(value: unknown): boolean {
  if (typeof value !== "string" || value.length !== 10 || value[4] !== "-" || value[7] !== "-" || !digits(value, 0, 4) || !digits(value, 5, 7) || !digits(value, 8, 10)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validTime(value: unknown): boolean {
  if (typeof value !== "string" || value.length !== 5 || value[2] !== ":" || !digits(value, 0, 2) || !digits(value, 3, 5)) return false;
  const hour = Number(value.slice(0, 2)); const minute = Number(value.slice(3, 5));
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
function validSuppliedValue(field: ExpectedField, value: unknown): boolean {
  if (field === "date") return validDate(value);
  if (field === "time") return validTime(value);
  return value !== undefined;
}
function expectedField(state: ConversationStateClean, raw: Record<string, unknown>): SuppliedField[] | null {
  if (Array.isArray(raw.suppliedFields)) {
    const supplied: SuppliedField[] = [];
    const seen = new Set<string>();
    for (const value of raw.suppliedFields) {
      const item = record(value);
      if (!item || typeof item.field !== "string" || !EXPECTED_FIELDS.has(item.field) || seen.has(item.field)
        || !validSuppliedValue(item.field as ExpectedField, item.value)) return null;
      seen.add(item.field);
      supplied.push({ field: item.field as ExpectedField, value: detachInterpretationValue(item.value) });
    }
    return supplied;
  }
  if (raw.answersExpectedField !== true || raw.expectedFieldValue === undefined || !state.expectedInput) return [];
  const field: ExpectedField = state.expectedInput.field;
  return [{ field, value: detachInterpretationValue(raw.expectedFieldValue) }];
}

export function mapStableInterpretation(rawInput: unknown, state: ConversationStateClean): TurnInterpretation | null {
  const wrapped = record(rawInput);
  const raw = parseRaw(wrapped && "interpretation" in wrapped ? wrapped.interpretation : rawInput);
  if (!raw || typeof raw.userAct !== "string" || !USER_ACTS.has(raw.userAct) || typeof raw.relation !== "string" || !RELATIONS.has(raw.relation)
    || typeof raw.normalizedMeaning !== "string" || !raw.normalizedMeaning || typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1
    || typeof raw.answersExpectedField !== "boolean") return null;
  const requestsRaw = array(raw.requests); const referencesRaw = array(raw.references); const correctionsRaw = array(raw.corrections);
  if (!requestsRaw || !referencesRaw || !correctionsRaw) return null;
  const intents = [];
  for (const value of requestsRaw) {
    const item = record(value);
    if (!item || typeof item.goal !== "string" || !record(item.entities)) return null;
    const serviceId = typeof item.serviceId === "string" ? item.serviceId : "";
    const kind = operationKind(serviceId, item.operationHint);
    const domain = taskType(serviceId, item.domain);
    if (!kind || !domain) return null;
    intents.push({ serviceId, domain, goal: item.goal, operationKind: kind, entities: detachInterpretationValue(item.entities as Record<string, unknown>) });
  }
  const references = mapReferences(referencesRaw);
  if (!references) return null;
  const suppliedFields = expectedField(state, raw);
  if (!suppliedFields) return null;
  const corrections = correctionsRaw.map((value) => record(value)).map((item) => item && typeof item.field === "string" ? { field: item.field, value: detachInterpretationValue(item.value) } : null);
  if (corrections.some((item) => !item)) return null;
  const ambiguityRaw = raw.ambiguity === undefined || raw.ambiguity === null ? undefined : record(raw.ambiguity);
  if (raw.ambiguity !== undefined && raw.ambiguity !== null && (!ambiguityRaw || typeof ambiguityRaw.reason !== "string" || !Array.isArray(ambiguityRaw.alternatives)
    || !ambiguityRaw.alternatives.every((item) => typeof item === "string") || typeof ambiguityRaw.clarificationQuestion !== "string")) return null;
  const confirmationRaw = raw.confirmation === undefined || raw.confirmation === null ? undefined : record(raw.confirmation);
  if (raw.confirmation !== undefined && raw.confirmation !== null
    && (!confirmationRaw || typeof confirmationRaw.intended !== "boolean" || typeof confirmationRaw.containsCorrections !== "boolean")) return null;
  const confirmationAct = raw.userAct === "confirmation" || raw.relation === "confirm";
  if (confirmationAct && !state.pendingOperation) return null;
  if (raw.answersExpectedField && state.expectedInput && state.expectedInput.field !== "confirmation"
    && raw.userAct !== "answer" && raw.userAct !== "correction") return null;
  return deepFreezeInterpretationValue({
    userAct: raw.userAct as UserAct, relation: raw.relation as ThreadRelation, normalizedMeaning: raw.normalizedMeaning,
    intents: Object.freeze(intents), references: Object.freeze(references), suppliedFields: Object.freeze(suppliedFields),
    corrections: Object.freeze(corrections as Array<{ field: string; value: unknown }>), answersExpectedField: raw.answersExpectedField,
    ...(confirmationRaw ? { confirmation: Object.freeze({ intended: confirmationRaw.intended as boolean, containsCorrections: confirmationRaw.containsCorrections as boolean }) } : {}),
    ...(ambiguityRaw ? { ambiguity: { reason: ambiguityRaw.reason as string, alternatives: [...ambiguityRaw.alternatives as string[]], clarificationQuestion: ambiguityRaw.clarificationQuestion as string } } : {}),
    confidence: raw.confidence,
  });
}
