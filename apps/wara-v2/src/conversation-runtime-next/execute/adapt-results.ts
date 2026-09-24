import type { CapabilityResult } from "../types/capability-result.js";

type ExecResult = {
  name?: string;
  capability?: string;
  facts?: string[];
  error?: string;
  structured?: Record<string, unknown>;
};

export function mapExecResultsToStructured(
  results: ExecResult[],
): CapabilityResult[] {
  return results.map((r) => {
    const capName = r.capability ?? r.name ?? "unknown";
    if (r.error === "no_unit" || r.error === "missing_fields") {
      return {
        capability: capName,
        status: "missing_input",
        facts: r.facts ?? [],
        missingFields: r.error === "no_unit" ? ["unit"] : ["fields"],
        error: r.error,
        structured: r.structured,
      };
    }
    if (r.error === "not_found") {
      return {
        capability: capName,
        status: "not_found",
        facts: r.facts ?? [],
        error: r.error,
        structured: r.structured,
      };
    }
    if (r.error) {
      return {
        capability: capName,
        status: "error",
        facts: r.facts ?? [],
        error: r.error,
        structured: r.structured,
      };
    }
    const name = capName;
    if (name.endsWith(".prepare")) {
      return {
        capability: name,
        status: "prepared",
        facts: r.facts ?? [],
        structured: r.structured,
      };
    }
    if (name.endsWith(".update") || name.endsWith(".issue") || name.endsWith(".create")) {
      return {
        capability: name,
        status: "committed",
        facts: r.facts ?? [],
        structured: r.structured,
      };
    }
    return {
      capability: name,
      status: "success",
      facts: r.facts ?? [],
      structured: r.structured,
    };
  });
}
