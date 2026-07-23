/** Traduce una ruta del panel a una etiqueta legible para el monitor externo de presencia. */
export function getPanelScreenLabel(pathname: string | null | undefined): string {
  const path = (pathname ?? "").trim();
  if (!path) return "—";

  const ticketMatch = path.match(/^\/tickets\/([^/]+)$/);
  if (ticketMatch && !TICKET_LIST_SLUGS.has(ticketMatch[1])) {
    return `Ticket #${ticketMatch[1]}`;
  }

  const known = KNOWN_ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (known) return known[1];

  return path;
}

const TICKET_LIST_SLUGS = new Set([
  "abiertos",
  "alta",
  "baja",
  "cerrados",
  "en-progreso",
  "esperando-cliente",
  "normal",
  "resueltos",
  "urgentes",
]);

const KNOWN_ROUTES: Array<[string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/tickets/abiertos", "Tickets abiertos"],
  ["/tickets/alta", "Tickets prioridad alta"],
  ["/tickets/baja", "Tickets prioridad baja"],
  ["/tickets/cerrados", "Tickets cerrados"],
  ["/tickets/en-progreso", "Tickets en progreso"],
  ["/tickets/esperando-cliente", "Tickets esperando cliente"],
  ["/tickets/normal", "Tickets prioridad normal"],
  ["/tickets/resueltos", "Tickets resueltos"],
  ["/tickets/urgentes", "Tickets urgentes"],
  ["/tickets", "Tickets"],
  ["/clientes", "Clientes"],
  ["/agentes", "Agentes"],
  ["/configuracion", "Configuración"],
  ["/login", "Login"],
];
