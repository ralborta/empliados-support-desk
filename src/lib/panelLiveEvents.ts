/**
 * Eventos livianos entre campana / sidebar / sync del panel.
 * Evita que el asesor quieto vea contadores stale (bug reportado 2026-09-30).
 */
export const PANEL_INBOX_CHANGED_EVENT = "kira:panel-inbox-changed";

export function dispatchPanelInboxChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PANEL_INBOX_CHANGED_EVENT));
}

export function subscribePanelInboxChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = () => handler();
  window.addEventListener(PANEL_INBOX_CHANGED_EVENT, listener);
  return () => window.removeEventListener(PANEL_INBOX_CHANGED_EVENT, listener);
}
