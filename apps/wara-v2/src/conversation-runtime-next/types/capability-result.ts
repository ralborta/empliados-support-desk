export type CapabilityResultStatus =
  | "success"
  | "missing_input"
  | "not_found"
  | "ambiguous"
  | "prepared"
  | "committed"
  | "gate_off"
  | "error";

export type CapabilityResult = {
  capability: string;
  status: CapabilityResultStatus;
  facts: string[];
  missingFields?: string[];
  error?: string;
  structured?: Record<string, unknown>;
};
