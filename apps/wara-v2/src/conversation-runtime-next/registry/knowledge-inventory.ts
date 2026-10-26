/**
 * Inventario interno: servicios + enrichers legacy retirados del path Next.
 * No es entregable; alimenta trazas y auditoría.
 */
import { CAPABILITY_CATALOG } from "../../commander-v3/capabilities/catalog.js";
import { SERVICE_REGISTRY } from "./service-registry.js";

export const LEGACY_ENRICHERS_NOT_IN_NEXT = [
  "thread-contract",
  "greeting-policy",
  "open-task-hold",
  "question-contract",
  "company-capture",
  "company-change",
  "company-ops-gate",
  "bare-fleet-dump",
  "task-switch",
] as const;

export function buildKnowledgeInventory(): {
  capabilities: number;
  services: number;
  legacyEnrichersExcluded: readonly string[];
} {
  return {
    capabilities: CAPABILITY_CATALOG.length,
    services: SERVICE_REGISTRY.length,
    legacyEnrichersExcluded: LEGACY_ENRICHERS_NOT_IN_NEXT,
  };
}
