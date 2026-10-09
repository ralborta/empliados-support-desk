#!/usr/bin/env node
/**
 * Contrato sync canal: generation last-write-wins, waitUntil, UI pending ≠ synced.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(root, "..", rel), "utf8");

const schema = read("prisma/schema.prisma");
assert.ok(schema.includes("botChannelSyncStatus"), "schema: botChannelSyncStatus");
assert.ok(schema.includes("botChannelSyncGeneration"), "schema: botChannelSyncGeneration");
assert.ok(schema.includes("botChannelSyncTarget"), "schema: botChannelSyncTarget");

const sync = read("src/lib/botChannelSync.ts");
assert.ok(sync.includes("waitUntil"), "botChannelSync usa waitUntil");
assert.ok(sync.includes("botChannelSyncGeneration"), "job respeta generation");
assert.ok(sync.includes("superseded"), "descarta sync viejo");
assert.ok(sync.includes("CHANNEL_SYNC_MAX_ATTEMPTS"), "reintentos acotados");
assert.ok(sync.includes("bumpChannelSyncGenerationAtomic") || sync.includes("RETURNING"), "bump atómico");
assert.ok(sync.includes("enqueueCustomerChannelSync"), "cola por cliente");

const pause = read("src/lib/atilioBotPause.ts");
assert.ok(pause.includes("scheduleChannelSyncJob"), "pause agenda job");
assert.ok(pause.includes("skipChannelIfAlreadyPaused"), "skip si ya synced");
assert.ok(pause.includes("forceChannelSync"), "force para reintentar");
assert.ok(pause.includes("syncStatus"), "expone syncStatus");

const messages = read("src/app/api/tickets/[id]/messages/route.ts");
assert.ok(
  messages.includes("awaitChannelSync: false") && messages.includes("skipChannelIfAlreadyPaused"),
  "messages no bloquea WA con sync",
);
assert.ok(messages.includes("panelOutboundTiming"), "métricas db/wa");
assert.ok(messages.includes("channelSyncStatus"), "GET expone channelSyncStatus");

const clientes = read("src/app/api/clientes/[id]/route.ts");
assert.ok(clientes.includes("awaitChannelSync: false"), "toggle no espera BBC");
assert.ok(clientes.includes("forceChannelSync"), "toggle acepta force");
assert.ok(clientes.includes("localPaused"), "separa local de synced");

const ui = read("src/components/tickets/BotPausedToggle.tsx");
assert.ok(ui.includes("sincronización con el canal pendiente"), "UI pending");
assert.ok(ui.includes("forceChannelSync"), "UI reintenta con force");

console.log("OK verify-bot-channel-sync");
