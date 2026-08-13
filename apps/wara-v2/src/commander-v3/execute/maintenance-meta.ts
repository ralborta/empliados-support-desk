/**
 * Inferencia de metadatos de mantenimiento desde el detalle ya capturado
 * (campo estructurado). No clasifica el mensaje libre del usuario.
 */
export type MaintenanceKind =
  | "preventivo"
  | "correctivo"
  | "rfid"
  | "plan"
  | "general";

export type MaintenancePriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export function inferMaintenanceMeta(detail: string): {
  kind: MaintenanceKind;
  priority: MaintenancePriority;
  kindLabel: string;
} {
  const t = detail
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let kind: MaintenanceKind = "general";
  if (/\brfid\b/.test(t)) kind = "rfid";
  else if (/\bplan\b/.test(t)) kind = "plan";
  else if (/\bpreventiv/.test(t) || /\bservice\b|\bserviceo\b/.test(t))
    kind = "preventivo";
  else if (/\bcorrectiv|\brepar|falla|roto|averi/.test(t)) kind = "correctivo";

  let priority: MaintenancePriority = "NORMAL";
  if (/\burgent|inmediato|ahora|grave|peligro/.test(t)) priority = "URGENT";
  else if (/\balta|prioridad alta|asap|cuanto antes/.test(t)) priority = "HIGH";
  else if (/\bbaja|cuando puedan|sin apuro/.test(t)) priority = "LOW";

  const kindLabel =
    kind === "preventivo"
      ? "preventivo"
      : kind === "correctivo"
        ? "correctivo"
        : kind === "rfid"
          ? "RFID"
          : kind === "plan"
            ? "plan"
            : "general";

  return { kind, priority, kindLabel };
}
