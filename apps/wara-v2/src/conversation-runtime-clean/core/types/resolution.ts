import type { CompanyState, ListingItem, UnitState } from "./state.js";
import type { OperationalFact } from "./response.js";
export type ResolvedEntity = Readonly<{ entityType: "company"; company: CompanyState }> | Readonly<{ entityType: "unit"; unit: UnitState }>;
export type ResolutionResult =
  | Readonly<{ requestId: string; status: "resolved"; entity: ResolvedEntity; facts: readonly OperationalFact[] }>
  | Readonly<{ requestId: string; status: "not_found"; facts: readonly OperationalFact[] }>
  | Readonly<{ requestId: string; status: "ambiguous"; candidates: readonly ListingItem[]; facts: readonly OperationalFact[] }>
  | Readonly<{ requestId: string; status: "invalid"; errors: readonly string[] }>
  | Readonly<{ requestId: string; status: "backend_error"; safeError: string }>;
