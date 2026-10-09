/**
 * Historial conversacional sanitizado (últimos N turnos).
 */
import type { PilotConversationState } from "../conversation-state.js";
import type { TurnDecision } from "./turn-decision-schema.js";

export type ConversationTurnLog = {
  role: "user" | "assistant";
  text: string;
  at: string;
  intent?: string;
  action?: string;
  tramite?: string;
};

const MAX_TURNS = 8;
const MAX_TEXT = 280;

function sanitizeText(text: string): string {
  return text
    .replace(/\+?\d{10,15}/g, "[phone]")
    .replace(/Bearer\s+\S+/gi, "[token]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[secret]")
    .slice(0, MAX_TEXT);
}

export function ensureRecentTurns(state: PilotConversationState): ConversationTurnLog[] {
  const anyState = state as PilotConversationState & { recentTurns?: ConversationTurnLog[] };
  if (!Array.isArray(anyState.recentTurns)) {
    anyState.recentTurns = [];
  }
  return anyState.recentTurns;
}

export function appendUserTurn(state: PilotConversationState, text: string): void {
  const turns = ensureRecentTurns(state);
  turns.push({
    role: "user",
    text: sanitizeText(text),
    at: new Date().toISOString(),
    tramite: state.activeTramite,
  });
  trimTurns(state);
}

export function appendAssistantTurn(
  state: PilotConversationState,
  text: string,
  decision?: TurnDecision | null,
): void {
  const turns = ensureRecentTurns(state);
  turns.push({
    role: "assistant",
    text: sanitizeText(text),
    at: new Date().toISOString(),
    intent: decision?.intent,
    action: decision?.action,
    tramite: state.activeTramite,
  });
  trimTurns(state);
}

function trimTurns(state: PilotConversationState): void {
  const turns = ensureRecentTurns(state);
  if (turns.length > MAX_TURNS * 2) {
    // user+assistant pairs → keep last MAX_TURNS*2 entries
    (state as PilotConversationState & { recentTurns: ConversationTurnLog[] }).recentTurns =
      turns.slice(-(MAX_TURNS * 2));
  }
}

export function recentTurnsForInterpreter(
  state: PilotConversationState,
): Array<{ role: "user" | "assistant"; text: string }> {
  return ensureRecentTurns(state)
    .slice(-(MAX_TURNS * 2))
    .map((t) => ({ role: t.role, text: t.text }));
}
