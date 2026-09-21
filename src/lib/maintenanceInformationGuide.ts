import type { PlatformKnowledgeInterpret } from "@/lib/infoGuideInterpretAI";
import { getMantenimientoArticlesByIds } from "@/lib/mantenimientoKnowledge";

export const MAINTENANCE_CONCEPT_ARTICLE_ID = "mt-concepto-y-mapa";
export const MAINTENANCE_ASSIGN_PLAN_ARTICLE_ID = "mt-asignar-plan-unidad";

export const MAINTENANCE_INFORMATION_AMBIGUOUS_CLARIFY =
  "¿Querés saber qué es Mantenimiento en Wara, cómo usarlo en la app, o registrar/programar uno para una unidad?";

/**
 * Destino tipado informativo de Mantenimiento.
 * Ancla artículos KB para no caer en fail-closed / menú genérico.
 */
export function isMaintenanceInformationInterpret(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): boolean {
  return interpret?.normalTarget === "maintenance_information";
}

export function isMaintenanceOperationInterpret(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): boolean {
  return interpret?.normalTarget === "maintenance_operation";
}

export function shouldRouteMaintenanceInformationToGuide(
  interpret: PlatformKnowledgeInterpret | null | undefined,
): boolean {
  return (
    isMaintenanceInformationInterpret(interpret) &&
    interpret?.route === "info_guides" &&
    interpret.executionRequest === false &&
    (interpret.need === "definition" ||
      interpret.need === "procedure" ||
      interpret.need === "ambiguous")
  );
}

/**
 * Respuesta anclada desde el corpus (sin segundo LLM).
 * Usar cuando el dominio tipado ya tiene articleIds y la composición falló o no hay API.
 */
export function replyFromAnchoredMaintenanceArticles(
  articleIds: string[],
  need: "definition" | "procedure" | "ambiguous" | "troubleshoot" | "execute" | null,
): string | null {
  if (need === "ambiguous") {
    return MAINTENANCE_INFORMATION_AMBIGUOUS_CLARIFY;
  }
  const articles = getMantenimientoArticlesByIds(articleIds);
  const primary = articles[0];
  if (!primary) return null;
  const parts = [primary.summary.trim(), "", primary.body.trim()].filter(Boolean);
  const text = parts.join("\n");
  if (text.length <= 1600) return text;
  return `${text.slice(0, 1550).trim()}…`;
}
