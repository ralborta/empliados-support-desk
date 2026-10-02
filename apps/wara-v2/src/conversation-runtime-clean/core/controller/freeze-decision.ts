import type { TurnDecision } from "../types/decision.js";

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function freezeTurnDecision(decision: TurnDecision): TurnDecision {
  return deepFreeze(decision);
}
