import {
  INTERNAL_NOTE_TEMPLATES,
  type InternalNoteTemplateId,
} from "@/lib/internalNoteTemplates";

export type QuickAction =
  | "request_data"
  | "in_analysis"
  | "derive"
  | "resolve"
  | "close"
  | "internal_note"
  | "note_admin"
  | "note_billing"
  | "note_collections";

export const QUICK_ACTIONS = [
  "request_data",
  "in_analysis",
  "derive",
  "resolve",
  "close",
  "internal_note",
  "note_admin",
  "note_billing",
  "note_collections",
] as const satisfies readonly QuickAction[];

const NOTE_ACTION_TO_TEMPLATE: Partial<
  Record<QuickAction, InternalNoteTemplateId>
> = {
  note_admin: "admin",
  note_billing: "billing",
  note_collections: "collections",
};

export function isL1AdminDerivationAction(action: QuickAction): boolean {
  return action in NOTE_ACTION_TO_TEMPLATE;
}

export function noteTemplateIdForAction(
  action: QuickAction,
): InternalNoteTemplateId | null {
  return NOTE_ACTION_TO_TEMPLATE[action] ?? null;
}

export function buildQuickActionCustomerMessage(action: QuickAction): string | null {
  const templateId = noteTemplateIdForAction(action);
  if (templateId) return INTERNAL_NOTE_TEMPLATES[templateId].customerMessage;

  switch (action) {
    case "request_data":
      return "Hola, para avanzar con tu consulta necesitamos más datos o detalle del problema. ¿Podés enviarnos lo que falte o aclarar el caso? Gracias.";
    case "in_analysis":
      return "Tu consulta está en análisis. Te mantendremos informados.";
    case "derive":
      return "Derivamos tu caso al área correspondiente. Te contactarán a la brevedad.";
    case "resolve":
      return "Registramos tu consulta como resuelta. Si necesitás algo más, escribinos.";
    case "close":
      return "Cerramos tu consulta. Gracias por contactarnos.";
    case "internal_note":
      return null;
    default:
      return null;
  }
}

export function quickActionTicketPatch(action: QuickAction): {
  status?: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
  resolution?: string | null;
  incidentType?: string | null;
} {
  if (isL1AdminDerivationAction(action)) {
    return {
      status: "RESOLVED",
      resolution: "ADMIN_DERIVATION_L1",
      incidentType: "ADMIN_DERIVATION",
    };
  }
  switch (action) {
    case "request_data":
      return { status: "WAITING_CUSTOMER" };
    case "in_analysis":
      return { status: "IN_PROGRESS" };
    case "derive":
      return { status: "IN_PROGRESS", resolution: "BACKOFFICE_DERIVED" };
    case "resolve":
      return { status: "RESOLVED", resolution: "CHAT_RESOLVED" };
    case "close":
      return { status: "CLOSED", resolution: "CLOSED_NO_ACTION" };
    default:
      return {};
  }
}
