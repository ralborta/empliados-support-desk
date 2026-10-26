/**
 * Orquestación de búsqueda semántica de unidades en un turno conversacional.
 */
import type { PilotConversationState } from "./conversation-state.js";
import {
  buildPaginatedListing,
  formatPaginatedFleetMessage,
  formatUnitLabel,
  isListingFresh,
  sliceListingPage,
  toFleetUnitRef,
} from "./unit-fleet.js";
import { interpretUnitSearchRules } from "./unit-search-semantics.js";
import {
  executeUnitSearch,
  formatUnitSearchManyHeader,
  formatUnitSearchNotFound,
} from "./unit-search-resolver.js";
import { understandUnitSearchUtterance } from "./utterance-understanding-v2.js";
import { mergeInterpretations } from "./unit-search-semantics.js";
import { extractUnitSearchHint } from "./plate-prefix.js";
import type { WaraUnidadEstado } from "./wara-types.js";
import type { PaginatedFleetListing } from "./unit-fleet.js";

export type SemanticUnitSearchOutcome =
  | { kind: "none" }
  | { kind: "not_found"; message: string }
  | { kind: "listing"; message: string; listing: PaginatedFleetListing }
  | { kind: "unit"; unit: WaraUnidadEstado; intent: "unit_status" | "find_unit" | "contextual_ref" };

function buildSearchContext(state: PilotConversationState) {
  return {
    lastListing: state.lastListing,
    selectedUnit: state.selectedUnit,
    listingFresh: isListingFresh(state.lastListing),
  };
}

function formatSearchListingMessage(
  listing: PaginatedFleetListing,
  interpretation: import("./unit-search-semantics.js").UnitSearchInterpretation,
  companyName: string | null,
  unitCount: number,
): string {
  const header = formatUnitSearchManyHeader(interpretation, unitCount, companyName);
  const pageUnits = sliceListingPage(listing);
  const startIdx = (listing.page - 1) * listing.pageSize;
  const lines = pageUnits.map((u, i) => `${startIdx + i + 1}. ${formatUnitLabel(u)}`);
  const totalPages = Math.max(1, Math.ceil(listing.totalCount / listing.pageSize));
  const nav =
    totalPages > 1
      ? `\n\nDecime el número (ej. «22» o «la 22»), «siguiente»/«anterior» para otra página, o la patente/nombre para buscar.`
      : `\n\nDecime el número o la patente/nombre de la unidad que querés consultar.`;
  return `${header}\n\n${lines.join("\n")}${nav}`;
}

export async function resolveSemanticUnitSearch(input: {
  state: PilotConversationState;
  text: string;
  fleet: WaraUnidadEstado[];
  threadText?: string;
  useLlm?: boolean;
}): Promise<SemanticUnitSearchOutcome> {
  const ctx = buildSearchContext(input.state);
  const rules = interpretUnitSearchRules(input.text, ctx);
  let interpretation = rules;

  if (input.useLlm !== false && (!rules || rules.confidence !== "high")) {
    const llm = await understandUnitSearchUtterance(input.text, input.threadText ?? "");
    interpretation = mergeInterpretations(rules, llm);
  }

  if (!interpretation) {
    const hint = extractUnitSearchHint(input.text);
    if (!hint) return { kind: "none" };
    interpretation = interpretUnitSearchRules(input.text, ctx);
    if (!interpretation) return { kind: "none" };
  }

  const result = executeUnitSearch(interpretation, input.fleet, {
    lastListing: input.state.lastListing,
    selectedUnit: input.state.selectedUnit,
    lastSelectedIndex: input.state.lastListingPickIndex ?? null,
  });

  if (result.kind === "none") {
    return {
      kind: "not_found",
      message: formatUnitSearchNotFound(interpretation, input.state.companyName),
    };
  }

  if (result.kind === "one") {
    const intent: "unit_status" | "find_unit" | "contextual_ref" =
      interpretation.intent === "unit_status"
        ? "unit_status"
        : interpretation.intent === "contextual_ref"
          ? "contextual_ref"
          : "find_unit";
    return { kind: "unit", unit: result.unit, intent };
  }

  const listing = buildPaginatedListing({
    units: result.units,
    page: 1,
    kind: "search_results",
    searchLabel: interpretation.query,
  });
  const message = formatSearchListingMessage(
    listing,
    interpretation,
    input.state.companyName,
    result.units.length,
  );

  return { kind: "listing", message, listing };
}

export function hasSemanticUnitSearchSignal(text: string, state: PilotConversationState): boolean {
  return interpretUnitSearchRules(text, buildSearchContext(state)) != null;
}

export function recordListingPick(state: PilotConversationState, index: number): void {
  state.lastListingPickIndex = index;
}

export function pickUnitRef(state: PilotConversationState, unit: WaraUnidadEstado): void {
  state.selectedUnit = toFleetUnitRef(unit);
  state.pendingConfirmation = null;
}

/** Aplica resultado semántico al estado y devuelve mensaje operativo. */
export function applySemanticSearchListing(
  state: PilotConversationState,
  listing: PaginatedFleetListing,
  message: string,
  showListing: (s: PilotConversationState, l: PaginatedFleetListing, m: string) => string,
): string {
  return showListing(state, listing, message);
}
