#!/usr/bin/env node
/**
 * Derivación de comunicación al asesor (plataforma, no Odoo):
 * - Responder desde el panel pausa Atilio
 * - Marcar IN_PROGRESS pausa Atilio
 * - Con botPausedAt, el contexto NO desmutea BBC y responde nextFlow=ignore
 *
 * Uso: npx tsx scripts/verify-advisor-comm-takeover.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const messages = readFileSync(join(root, "../src/app/api/tickets/[id]/messages/route.ts"), "utf8");
assert.ok(
  messages.includes("pauseAtilioForCustomer"),
  "messages debe pausar Atilio al responder el asesor",
);
assert.ok(
  messages.includes("human_outbound_takeover"),
  "messages debe marcar reason human_outbound_takeover",
);

const ticketPatch = readFileSync(join(root, "../src/app/api/tickets/[id]/route.ts"), "utf8");
assert.ok(
  ticketPatch.includes('rest.status === "IN_PROGRESS"'),
  "PATCH ticket debe pausar al pasar a IN_PROGRESS",
);
assert.ok(
  ticketPatch.includes("pauseAtilioForCustomer"),
  "PATCH ticket debe llamar pauseAtilioForCustomer",
);

const ctx = readFileSync(join(root, "../src/lib/builderbotCustomerContext.ts"), "utf8");
assert.ok(
  ctx.includes("human_takeover_bot_paused"),
  "contexto debe cortar turno si botPausedAt",
);
assert.ok(
  ctx.includes("existingCustomer?.botPausedAt"),
  "contexto debe leer botPausedAt antes de desmutear",
);
assert.ok(
  /botPausedAt[\s\S]*ensureBuilderBotContactActive/.test(ctx) ||
    ctx.indexOf("botPausedAt") < ctx.indexOf("ensureBuilderBotContactActive"),
  "chequeo de pausa debe ir antes de ensureBuilderBotContactActive",
);
assert.ok(
  /await ensureBuilderBotContactActive\(normalized\)/.test(ctx),
  "contexto debe esperar la reconciliación BBC (no void)",
);
assert.ok(
  !/void ensureBuilderBotContactActive/.test(ctx),
  "contexto no debe disparar mute/blacklist en segundo plano",
);

const pauseLib = readFileSync(join(root, "../src/lib/atilioBotPause.ts"), "utf8");
assert.ok(pauseLib.includes("setBuilderBotCloudBlacklist"), "pause debe blacklist BBC");
assert.ok(pauseLib.includes("setBotBlacklist"), "pause debe blacklist self-hosted");
assert.ok(pauseLib.includes("setBuilderBotContactMute"), "pause/reactivate debe tocar /mute BBC");
assert.ok(
  pauseLib.includes("ensureBuilderBotContactActive"),
  "reactivate debe reconciliar mute=false + blacklist=remove",
);
assert.ok(
  !/if\s*\(\s*!customer\?\.botPausedAt\s*\)\s*return\s+false/.test(pauseLib),
  "reactivate no debe salir si botPausedAt ya es null: hay que reconciliar BBC",
);
assert.ok(
  /localWasPaused/.test(pauseLib),
  "reactivate debe reconciliar aunque el estado local ya esté activo",
);

const bbc = readFileSync(join(root, "../src/lib/builderbot.ts"), "utf8");
assert.ok(
  /setBuilderBotContactMute[\s\S]*Promise<boolean>/.test(bbc),
  "mute BBC debe reportar éxito/fallo",
);
assert.ok(
  /setBuilderBotCloudBlacklist[\s\S]*Promise<boolean>/.test(bbc),
  "blacklist BBC debe reportar éxito/fallo",
);

const turn = readFileSync(join(root, "../src/lib/whatsappTurn.ts"), "utf8");
assert.ok(
  turn.includes("humanTakeover") && turn.includes("botPaused_s"),
  "/turn no debe bypassear ignore cuando hay takeover humano",
);

console.log("OK verify-advisor-comm-takeover");
