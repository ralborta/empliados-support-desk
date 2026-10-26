/**
 * Plantillas de nota interna / cierre L1 (Ola 3).
 * Speach oficial Mesa (2026-10-26): Administración + Cobranzas con números WA.
 * Facturación usa el speach de Administración (incluye facturación en el texto).
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

/** Speach Mesa → Administración (+ facturación / altas / bajas / docs). */
export const ADMIN_L1_CUSTOMER_MESSAGE =
  "Administracion: ¡Hola! 😊 Gracias por comunicarte con Wara.\n\n" +
  "Este canal está destinado exclusivamente a la Mesa de Ayuda (soporte técnico de la plataforma y los equipos GPS).\n\n" +
  "Para consultas administrativas (facturación, altas, bajas, modificaciones de servicio o documentación), te pedimos que te comuniques al siguiente número:\n\n" +
  "📞 +54 9 2615 25-6758\n" +
  "👉 wa.me/5492615256758\n\n" +
  "Allí te van a atender con gusto. ¡Que tengas un excelente día!";

/** Speach Mesa → Cobranzas. */
export const COLLECTIONS_L1_CUSTOMER_MESSAGE =
  "Cobranzas: ¡Hola! 😊 Gracias por comunicarte con Wara.\n\n" +
  "Este canal está destinado exclusivamente a la Mesa de Ayuda (soporte técnico de la plataforma y los equipos GPS).\n\n" +
  "Para consultas sobre Cobranzas (pagos, saldos, comprobantes, vencimientos o medios de pago), te pedimos que te comuniques al siguiente número:\n\n" +
  "📞 +54 9 2617 22-2296\n" +
  "👉 wa.me/5492617222296\n\n" +
  "El equipo te va a ayudar a resolverlo. ¡Muchas gracias por tu paciencia!";

export const INTERNAL_NOTE_TEMPLATES: Record<
  InternalNoteTemplateId,
  InternalNoteTemplate
> = {
  admin: {
    id: "admin",
    label: "Administración",
    internalNote:
      "[Derivación L1] Administración — speach oficial enviado (+54 9 2615 25-6758). " +
      "Cerrado en primer nivel. Seguimiento: área Administración.",
    customerMessage: ADMIN_L1_CUSTOMER_MESSAGE,
  },
  billing: {
    id: "billing",
    label: "Facturación",
    internalNote:
      "[Derivación L1] Facturación — speach Administración/facturación enviado (+54 9 2615 25-6758). " +
      "Cerrado en primer nivel. Seguimiento: área Facturación / Administración.",
    // Mismo speach que Administración (incluye facturación en el texto oficial).
    customerMessage: ADMIN_L1_CUSTOMER_MESSAGE,
  },
  collections: {
    id: "collections",
    label: "Cobranza",
    internalNote:
      "[Derivación L1] Cobranzas — speach oficial enviado (+54 9 2617 22-2296). " +
      "Cerrado en primer nivel. Seguimiento: área Cobranzas.",
    customerMessage: COLLECTIONS_L1_CUSTOMER_MESSAGE,
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
