export type QuickAction =
  | "request_data"
  | "in_analysis"
  | "derive"
  | "resolve"
  | "close"
  | "internal_note";

export const QUICK_ACTIONS = [
  "request_data",
  "in_analysis",
  "derive",
  "resolve",
  "close",
  "internal_note",
] as const satisfies readonly QuickAction[];

export function buildQuickActionCustomerMessage(action: QuickAction): string | null {
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
} {
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
