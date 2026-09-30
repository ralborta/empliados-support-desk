#!/usr/bin/env node
/**
 * Contadores del sidebar deben poder refrescarse en vivo (bug asesor quieto 2026-09-30).
 * Uso: npx tsx scripts/verify-panel-inbox-live-counts.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

const events = readFileSync(join(root, "src/lib/panelLiveEvents.ts"), "utf8");
assert.match(events, /PANEL_INBOX_CHANGED_EVENT/, "evento compartido");
assert.match(events, /dispatchPanelInboxChanged/, "dispatch exportado");
assert.match(events, /subscribePanelInboxChanged/, "subscribe exportado");

const sidebar = readFileSync(join(root, "src/components/tickets/TicketsLayout.tsx"), "utf8");
assert.match(sidebar, /usePollWhenVisible\(refreshCounts/, "sidebar poll de counts");
assert.match(sidebar, /subscribePanelInboxChanged\(refreshCounts\)/, "sidebar escucha evento");
assert.match(sidebar, /\/api\/nav\/counts/, "sigue usando nav counts");

const bell = readFileSync(join(root, "src/components/layout/NotificationBell.tsx"), "utf8");
assert.match(bell, /dispatchPanelInboxChanged\(\)/, "campana dispara evento en brandNew");
assert.match(bell, /router\.refresh\(\)/, "campana refresca listas RSC");

const live = readFileSync(join(root, "src/components/layout/PanelLiveSync.tsx"), "utf8");
assert.match(live, /dispatchPanelInboxChanged\(\)/, "live sync avisa al sidebar");

console.log("OK verify-panel-inbox-live-counts");
