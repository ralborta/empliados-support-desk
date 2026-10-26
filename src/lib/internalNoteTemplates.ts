/**
 * Plantillas de nota interna / cierre L1 (Ola 3).
 * Mesa: administración, cobranza y facturación sin tipear a mano.
 */

export type InternalNoteTemplateId = "admin" | "billing" | "collections";

export type InternalNoteTemplate = {
  id: InternalNoteTemplateId;
  /** Botón en el panel */
  label: string;
  /** Nota interna (solo panel) */
  internalNote: string;
  /** Mensaje al cliente por WhatsApp */
  customerMessage: string;
};

export const INTERNAL_NOTE_TEMPLATES: Record<
  InternalNoteTemplateId,
  InternalNoteTemplate
> = {
  admin: {
    id: "admin",
    label: "Administración",
    internalNote:
      "[Derivación L1] Administración — el cliente consultó un tema administrativo. " +
      "Cerrado en primer nivel; no corresponde a soporte técnico Kira. Seguimiento: área Administración.",
    customerMessage:
      "Tu consulta es de *Administración*. Desde soporte no la gestionamos nosotros: " +
      "quedó derivada al área correspondiente y cerramos este chat. " +
      "Si necesitás algo técnico de unidades/GPS, escribinos de nuevo. ¡Gracias!",
  },
  billing: {
    id: "billing",
    label: "Facturación",
    internalNote:
      "[Derivación L1] Facturación — consulta de facturas / comprobantes / datos fiscales. " +
      "Cerrado en primer nivel. Seguimiento: área Facturación.",
    customerMessage:
      "Tu consulta es de *Facturación*. Desde soporte no emitimos ni modificamos facturas: " +
      "quedó derivada al área de Facturación y cerramos este chat. " +
      "Ante un tema de unidades/GPS, escribinos cuando quieras. ¡Gracias!",
  },
  collections: {
    id: "collections",
    label: "Cobranza",
    internalNote:
      "[Derivación L1] Cobranza / pagos — el cliente consultó pagos, deuda o medios de pago. " +
      "Cerrado en primer nivel. Seguimiento: área Cobranza.",
    customerMessage:
      "Tu consulta es de *Cobranza / pagos*. Desde soporte no gestionamos cobros: " +
      "quedó derivada al área de Cobranza y cerramos este chat. " +
      "Si es por una unidad o el GPS, escribinos de nuevo. ¡Gracias!",
  },
};

export const INTERNAL_NOTE_TEMPLATE_IDS = Object.keys(
  INTERNAL_NOTE_TEMPLATES,
) as InternalNoteTemplateId[];

export function isInternalNoteTemplateId(
  v: unknown,
): v is InternalNoteTemplateId {
  return typeof v === "string" && v in INTERNAL_NOTE_TEMPLATES;
}
