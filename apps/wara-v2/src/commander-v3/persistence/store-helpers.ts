import type { ConversationStateV3 } from "../types/state.js";
import { createEmptyConversationStateV3 } from "../types/state.js";
import type { CompanyRef } from "../types/refs.js";
import {
  getConversationStateV3,
  saveConversationStateV3,
} from "./store.js";

export {
  getConversationStateV3,
  saveConversationStateV3,
  resetConversationStateV3,
  getLastTraceV3,
  saveLastTraceV3,
  migrateSafeContextFromV2,
} from "./store.js";

export function createEmptyIfNeeded(
  tenantId: string,
  phone: string,
  availableCompanies: CompanyRef[],
): ConversationStateV3 {
  const existing = getConversationStateV3(tenantId, phone);
  if (existing) return existing;
  const empty = createEmptyConversationStateV3({
    tenantId,
    phone,
    availableCompanies,
  });
  saveConversationStateV3(empty);
  return empty;
}
