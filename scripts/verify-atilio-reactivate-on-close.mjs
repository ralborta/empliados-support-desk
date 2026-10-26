#!/usr/bin/env node
/**
 * Contrato 2026-10-07:
 * - Resolver/cerrar reactiva solo pausa `auto` sin otros tickets abiertos.
 * - Pausa `manual` solo se levanta con «Reactivar Kira».
 * - Clear de resolve es atómico (updateMany solo null|auto) para no borrar
 *   una pausa manual aplicada en carrera.
 *
 * Uso: npx tsx scripts/verify-atilio-reactivate-on-close.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPLICIT_KIRA_REACTIVATE_REASON,
  RESOLVE_AUTO_REACTIVATE_REASON,
  clearAutoBotPauseAtomic,
  isAllowedKiraReactivateReason,
  isTerminalTicketStatus,
  mergePauseSource,
  pauseSourceFromReason,
  reactivateAtilioAfterTicketClosed,
} from "../src/lib/atilioBotPause.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

assert.equal(isTerminalTicketStatus("RESOLVED"), true);
assert.equal(isTerminalTicketStatus("CLOSED"), true);
assert.equal(isTerminalTicketStatus("OPEN"), false);

assert.equal(pauseSourceFromReason(EXPLICIT_KIRA_REACTIVATE_REASON), "manual");
assert.equal(pauseSourceFromReason("human_outbound_takeover"), "auto");
assert.equal(mergePauseSource("manual", "auto"), "manual");
assert.equal(mergePauseSource("auto", "manual"), "manual");
assert.equal(mergePauseSource(null, "auto"), "auto");

assert.equal(isAllowedKiraReactivateReason(EXPLICIT_KIRA_REACTIVATE_REASON), true);
assert.equal(isAllowedKiraReactivateReason(RESOLVE_AUTO_REACTIVATE_REASON), true);
assert.equal(isAllowedKiraReactivateReason("panel:patch-status"), false);

const pauseLib = fs.readFileSync(path.join(root, "src/lib/atilioBotPause.ts"), "utf8");
assert.match(pauseLib, /RESOLVE_AUTO_REACTIVATE_REASON/);
assert.match(pauseLib, /botPausedSource/);
assert.match(pauseLib, /pausa manual/);
assert.match(pauseLib, /quedan .+ ticket/);
assert.match(pauseLib, /onlyIfAutoSource:\s*true/);
assert.match(pauseLib, /commitLocalClearAndBumpAtomic/);
assert.match(pauseLib, /commitRetryBumpFromLocalPauseAtomic/);
assert.match(pauseLib, /commitLocalPauseAndBumpAtomic/);

const mockDb = {
  customer: {
    findUnique: async () => null,
  },
  ticket: { count: async () => 0 },
};

// Sin customer → false (no inventa reactivación).
const noopTerminal = await reactivateAtilioAfterTicketClosed(
  {
    customerId: "fake-customer-missing",
    ticketId: "fake-ticket",
    previousStatus: "RESOLVED",
    newStatus: "CLOSED",
  },
  mockDb,
);
assert.equal(noopTerminal, false, "RESOLVED→CLOSED → false");

const noopMissing = await reactivateAtilioAfterTicketClosed(
  {
    customerId: "fake-customer-missing",
    ticketId: "fake-ticket",
    previousStatus: "OPEN",
    newStatus: "RESOLVED",
    reason: "panel:patch-status",
  },
  mockDb,
);
assert.equal(noopMissing, false, "customer inexistente → false");

const mockManual = {
  customer: {
    findUnique: async () => ({
      id: "c1",
      botPausedAt: new Date(),
      botPausedSource: "manual",
    }),
  },
  ticket: { count: async () => 0 },
};
const keepManual = await reactivateAtilioAfterTicketClosed(
  {
    customerId: "c1",
    ticketId: "t1",
    previousStatus: "OPEN",
    newStatus: "RESOLVED",
    reason: "panel:patch-status",
  },
  mockManual,
);
assert.equal(keepManual, false, "pausa manual → no reactiva al resolver");

const mockOtherOpen = {
  customer: {
    findUnique: async () => ({
      id: "c1",
      botPausedAt: new Date(),
      botPausedSource: "auto",
    }),
  },
  ticket: { count: async () => 2 },
};
const keepOther = await reactivateAtilioAfterTicketClosed(
  {
    customerId: "c1",
    ticketId: "t1",
    previousStatus: "OPEN",
    newStatus: "RESOLVED",
  },
  mockOtherOpen,
);
assert.equal(keepOther, false, "otros tickets abiertos → no reactiva");

// Clear+bump atómico: $queryRaw sin rows → no programa active.
let queryRawCalls = 0;
const mockAtomicRace = {
  customer: {
    findUnique: async () => ({
      id: "c-race",
      botPausedAt: new Date(),
      botPausedSource: "auto",
      phone: null,
      botChannelSyncGeneration: 1,
      botChannelSyncStatus: "synced",
      botChannelSyncTarget: "paused",
    }),
  },
  ticket: { count: async () => 0 },
  $queryRaw: async () => {
    queryRawCalls += 1;
    return [];
  },
};
const raceManual = await reactivateAtilioAfterTicketClosed(
  {
    customerId: "c-race",
    ticketId: "t-race",
    previousStatus: "OPEN",
    newStatus: "RESOLVED",
  },
  mockAtomicRace,
);
assert.equal(raceManual, false, "clear+bump atómico 0 rows → no reactiva");
assert.equal(queryRawCalls, 1, "resolve usa commit clear+bump atómico");

const cleared = await clearAutoBotPauseAtomic("c2", {
  customer: {
    updateMany: async ({ where }) => {
      assert.ok(where.OR?.some((c) => c.botPausedSource === "auto"));
      assert.ok(where.OR?.some((c) => c.botPausedSource === null));
      return { count: 1 };
    },
  },
});
assert.equal(cleared, true, "clearAutoBotPauseAtomic count=1 → true");

const toggle = fs.readFileSync(
  path.join(root, "src/components/tickets/BotPausedToggle.tsx"),
  "utf8",
);
assert.match(toggle, /retryChannelSync:\s*true/, "UI reintenta sin putPaused(manual)");
assert.equal(
  /putPaused\(shown,\s*true\)/.test(toggle),
  false,
  "retry no llama putPaused(shown,true)",
);

const clientes = fs.readFileSync(
  path.join(root, "src/app/api/clientes/[id]/route.ts"),
  "utf8",
);
assert.match(clientes, /retryAtilioChannelSyncDetailed/, "API retry dedicado");
assert.match(clientes, /retryChannelSync/, "schema retryChannelSync");

const migration = fs.readFileSync(
  path.join(root, "prisma/migrations/20261007220000_customer_bot_paused_source/migration.sql"),
  "utf8",
);
assert.match(migration, /Política de backfill/, "migración documenta backfill → auto");

for (const rel of [
  "src/app/api/tickets/[id]/quick-action/route.ts",
  "src/app/api/tickets/[id]/route.ts",
  "src/lib/customerConversationClose.ts",
  "src/app/api/tickets/[id]/close-by-ai/route.ts",
]) {
  const content = fs.readFileSync(path.join(root, rel), "utf8");
  assert.match(content, /reactivateAtilioAfterTicketClosed/, `${rel} usa helper de cierre`);
  assert.equal(
    /reactivateAtilioForCustomer\(/.test(content),
    false,
    `${rel} no reactiva directo`,
  );
}

const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
assert.match(schema, /botPausedSource/);

console.log("OK verify-atilio-reactivate-on-close (auto vs manual)");
