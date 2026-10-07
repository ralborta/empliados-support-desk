#!/usr/bin/env node
/**
 * Contrato 2026-10-07:
 * - Resolver/cerrar reactiva solo pausa `auto` sin otros tickets abiertos.
 * - Pausa `manual` solo se levanta con «Reactivar Kira».
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
