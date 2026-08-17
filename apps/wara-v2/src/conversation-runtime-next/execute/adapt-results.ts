import type { CapabilityResult } from "../types/capability-result.js";

type ExecResult = {
  name: string;
  facts?: string[];
  error?: string;
  structured?: Record<string, unknown>;
};

export function mapExecResultsToStructured(
  results: ExecResult[],
): CapabilityResult[] {
  return results.map((r) => {
    if (r.error === "no_unit" || r.error === "missing_fields") {
      return {
        capability: r.name,
        status: "missing_input",
        facts: r.facts ?? [],
        missingFields: r.error === "no_unit" ? ["unit"] : ["fields"],
        error: r.error,
        structured: r.structured,
      };
    }
    if (r.error === "not_found") {
      return {
        capability: r.name,
        status: "not_found",
        facts: r.facts ?? [],
        error: r.error,
        structured: r.structured,
      };
    }
    if (r.error) {
      return {
        capability: r.name,
        status: "error",
        facts: r.facts ?? [],
        error: r.error,
        structured: r.structured,
      };
    }
    const name = r.name;
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
