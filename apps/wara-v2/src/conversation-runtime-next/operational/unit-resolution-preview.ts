import {
  resolveUnitReference,
  type UnitResolveResult,
} from "../../commander-v3/entities/resolve.js";
import type { EntityReference } from "../../commander-v3/types/refs.js";
import type { ConversationStateV3 } from "../../commander-v3/types/state.js";
import type { UnresolvedRequirement } from "./types.js";

export type UnitResolutionPreview = UnitResolveResult & {
  statusKind: "resolved" | "not_found" | "ambiguous" | "invalid" | "pending";
};

export function previewUnitResolution(
  unitReference: EntityReference | null | undefined,
  state: ConversationStateV3,
): UnitResolutionPreview {
  if (!unitReference) {
    return { status: "not_found", statusKind: "pending", query: "" };
  }
  const res = resolveUnitReference(unitReference, state);
  if (res.status === "exact") {
    return { ...res, statusKind: "resolved" };
  }
  if (res.status === "many") {
    return { ...res, statusKind: "ambiguous" };
  }
  if (res.status === "not_found") {
    return { ...res, statusKind: "not_found" };
  }
  return { ...res, statusKind: "invalid" };
}

export function unresolvedFromUnitPreview(
  preview: UnitResolutionPreview,
  expectedUnit: boolean,
): UnresolvedRequirement | null {
  if (!expectedUnit || preview.statusKind === "pending" || preview.statusKind === "resolved") {
    return null;
  }
  if (preview.statusKind === "ambiguous") {
    return {
      field: "unit",
      status: "ambiguous",
      query: preview.query,
      detail: preview.labels?.join("; "),
    };
  }
  if (preview.statusKind === "not_found") {
    return {
      field: "unit",
      status: "not_found",
      query: preview.query,
    };
  }
  return {
    field: "unit",
    status: "invalid",
    query: preview.query,
  };
}
