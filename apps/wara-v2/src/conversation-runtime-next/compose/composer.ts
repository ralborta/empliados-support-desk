import {
  formatGreeting,
  formatCompanyActive,
  formatCompanyList,
  formatUnitActive,
  confirmFooter,
} from "../../commander-v3/reply/format-wa.js";
import type { TurnDecision } from "../types/decision.js";
import type { TurnInterpretation } from "../types/interpretation.js";
import type { CapabilityResult } from "../types/capability-result.js";
import type { ConversationStateVNext } from "../state/vnext-types.js";
import { pendingTaskLabel } from "../state/reduce.js";
import { composeReplyWithLlm } from "./llm-composer.js";

function looksLikeListingFact(f: string): boolean {
  const lines = f.split("\n").filter((l) => l.trim());
  const numbered = lines.filter((l) => /^\d+\.\s/.test(l.trim())).length;
  return numbered >= 2 || (/Unidades en/i.test(f) && numbered >= 1);
}

function looksLikeLockedFormFact(f: string): boolean {
  return /Pasame el valor|Respondé \*CONFIRMO|\*CONFIRMO\* o \*CANCELAR\*|¿Confirmás|Cancelé el trámite|Dejamos pendiente|Dale, seguimos/i.test(
    f,
  );
}

function looksLikeAskUnitFact(f: string): boolean {
  return /¿De qué unidad\?|necesito la patente|Pasame la \*patente\*/i.test(f);
}

export function extractProtectedBlocks(facts: string[]): string[] {
  return facts.filter(
    (f) =>
      f.trim() &&
      (looksLikeListingFact(f) ||
        looksLikeLockedFormFact(f) ||
        looksLikeAskUnitFact(f) ||
        /Google Maps|#\d{5,}|CONFIRMO|CANCELAR|➡️/i.test(f)),
  );
}

export type ComposeInput = {
  decision: TurnDecision;
  interpretation: TurnInterpretation;
  facts: string[];
  capabilityResults: CapabilityResult[];
  state: ConversationStateVNext;
  customerName?: string | null;
};

export function composeReplyDeterministic(input: ComposeInput): string {
  const { decision: d, facts, state } = input;

  if (d.action === "clarify" || d.action === "keep_or_close") {
    const q = d.responseGoal.nextQuestion?.trim();
    if (q) return q;
  }

  if (d.conversationalAct === "greet") {
    const pending = pendingTaskLabel(state);
    const companyList =
      !state.company && state.availableCompanies.length > 1
        ? state.availableCompanies.map((c, i) => `${i + 1}. ${c.name}`).join("\n")
        : null;
    return formatGreeting({
      introduced: state.conversationMetadata.introducedAtilio,
      companyName: state.company?.name ?? input.customerName ?? null,
      pendingTaskLabel: pending,
      companyListBlock: companyList,
    });
  }

  if (d.action === "cancel") {
    if (facts.some((f) => /cancel/i.test(f))) {
      return facts.filter((f) => f.trim()).join("\n\n");
    }
    return "Listo, cancelamos ese trámite. ¿En qué más te ayudo?";
  }

  if (d.action === "confirm_write") {
    const locked = facts.filter(looksLikeLockedFormFact);
    if (locked.length) return locked.join("\n\n");
  }

  const protectedBlocks = extractProtectedBlocks(facts);
  if (protectedBlocks.length) {
    return protectedBlocks.join("\n\n");
  }

  if (d.authorizedCapabilities.some((c) => c.name === "company.get_active") && state.company) {
    return formatCompanyActive(state.company.name);
  }

  if (d.authorizedCapabilities.some((c) => c.name === "unit.get_active") && state.unit) {
    return formatUnitActive(state.unit.label);
  }

  if (facts.length) {
    return facts.filter((f) => f.trim()).join("\n\n");
  }

  if (d.responseGoal.nextQuestion) {
    return d.responseGoal.nextQuestion;
  }

  return "¿En qué te ayudo?";
}

export async function composeReply(
  input: ComposeInput & {
    env: NodeJS.ProcessEnv;
    userMessage: string;
    lastAssistantReply?: string | null;
  },
): Promise<{ reply: string; usedLlm: boolean; latencyMs: number }> {
  return composeReplyWithLlm(input);
}

export function composeConfirmReminder(): string {
  return confirmFooter();
}

export function composeCompanyList(state: ConversationStateVNext): string {
  const lines = state.availableCompanies.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
  return formatCompanyList(lines);
}

/** Solo filtra caps: no modifica intención ni reasoning del plan. */
export function stripBareFleetSearchCaps(
  caps: TurnDecision["authorizedCapabilities"],
  task: TurnDecision["task"],
): TurnDecision["authorizedCapabilities"] {
  return caps.filter((c) => {
    if (c.name !== "unit.search") return true;
    const q = String(c.params?.query ?? "").trim();
    if (q) return true;
    return task === "unit_query";
  });
}
