import type { KnowledgeDocument } from "../../core/knowledge/contracts.js";

// Seed evidence only. Product/content owners must validate tenant/company material before adding it here.
export const CLEAN_KNOWLEDGE_FIXTURES: readonly KnowledgeDocument[] = Object.freeze([
  {
    id: "platform.units.navigation", source: "manual:platform-units", version: "clean-seed-1",
    text: "La sección Unidades concentra la consulta de la flota y el acceso al detalle de una unidad.",
    scope: "domain", domain: "platform", humanValidated: true,
  },
  {
    id: "platform.maintenance.navigation", source: "manual:platform-maintenance", version: "clean-seed-1",
    text: "El módulo Mantenimiento permite consultar y gestionar registros asociados a una unidad.",
    scope: "domain", domain: "platform", humanValidated: true,
  },
]);
