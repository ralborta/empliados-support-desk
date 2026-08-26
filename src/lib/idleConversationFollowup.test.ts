/**
 * Regresión: decisión idle follow-up (nudge 15m / close 30m) + ciclo con mocks.
 * Uso: npx tsx --test src/lib/idleConversationFollowup.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideIdleFollowup,
  IDLE_CLOSE_KIND,
  IDLE_CLOSE_MESSAGE,
  IDLE_NUDGE_KIND,
  IDLE_NUDGE_MESSAGE,
  isIdleSystemOutbound,
  runIdleConversationFollowupCycle,
} from "./idleConversationFollowup";

const NUDGE_MS = 15 * 60 * 1000;
const CLOSE_MS = 30 * 60 * 1000;

describe("decideIdleFollowup", () => {
  const now = new Date("2026-08-26T15:00:00.000Z");

  it("none si bot pausado (asesor)", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: true,
        lastMessage: {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: new Date(now.getTime() - CLOSE_MS),
        },
        lastSubstantiveBotAt: new Date(now.getTime() - CLOSE_MS),
        idleNudgeAlreadySent: false,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "none",
    );
  });

  it("none si el último mensaje es del cliente", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: false,
        lastMessage: {
          direction: "INBOUND",
          from: "CUSTOMER",
          createdAt: new Date(now.getTime() - CLOSE_MS),
        },
        lastSubstantiveBotAt: new Date(now.getTime() - CLOSE_MS),
        idleNudgeAlreadySent: false,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "none",
    );
  });

  it("none si el último es HUMAN (asesor)", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: false,
        lastMessage: {
          direction: "OUTBOUND",
          from: "HUMAN",
          createdAt: new Date(now.getTime() - CLOSE_MS),
        },
        lastSubstantiveBotAt: new Date(now.getTime() - CLOSE_MS),
        idleNudgeAlreadySent: false,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "none",
    );
  });

  it("nudge a los 15 min sin nudge previo", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: false,
        lastMessage: {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: new Date(now.getTime() - NUDGE_MS),
        },
        lastSubstantiveBotAt: new Date(now.getTime() - NUDGE_MS),
        idleNudgeAlreadySent: false,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "nudge",
    );
  });

  it("none a los 15 min si ya hubo nudge (espera cierre)", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: false,
        lastMessage: {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: new Date(now.getTime() - 5 * 60 * 1000),
          autoReplyKind: IDLE_NUDGE_KIND,
        },
        lastSubstantiveBotAt: new Date(now.getTime() - NUDGE_MS - 5 * 60 * 1000),
        idleNudgeAlreadySent: true,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "none",
    );
  });

  it("close a los 30 min aunque el último sea el nudge", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: false,
        lastMessage: {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: new Date(now.getTime() - 15 * 60 * 1000),
          autoReplyKind: IDLE_NUDGE_KIND,
        },
        lastSubstantiveBotAt: new Date(now.getTime() - CLOSE_MS),
        idleNudgeAlreadySent: true,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "close",
    );
  });

  it("close a los 30 min sin nudge previo (catch-up)", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: false,
        lastMessage: {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: new Date(now.getTime() - CLOSE_MS),
        },
        lastSubstantiveBotAt: new Date(now.getTime() - CLOSE_MS),
        idleNudgeAlreadySent: false,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "close",
    );
  });

  it("none antes de los 15 min", () => {
    assert.equal(
      decideIdleFollowup({
        now,
        botPaused: false,
        lastMessage: {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
        lastSubstantiveBotAt: new Date(now.getTime() - 10 * 60 * 1000),
        idleNudgeAlreadySent: false,
        nudgeAfterMs: NUDGE_MS,
        closeAfterMs: CLOSE_MS,
      }),
      "none",
    );
  });
});

describe("isIdleSystemOutbound", () => {
  it("marca nudge y close", () => {
    assert.equal(isIdleSystemOutbound(IDLE_NUDGE_KIND), true);
    assert.equal(isIdleSystemOutbound("idle_close"), true);
    assert.equal(isIdleSystemOutbound("customer_requested_close"), false);
    assert.equal(isIdleSystemOutbound(null), false);
  });
});

function makeMockDb(ticket: {
  id: string;
  code: string;
  status: string;
  customerId: string;
  phone: string;
  lastMessageAt: Date;
  messages: Array<{
    direction: "INBOUND" | "OUTBOUND";
    from: "CUSTOMER" | "BOT" | "HUMAN";
    createdAt: Date;
    rawPayload?: unknown;
  }>;
}) {
  const createdMessages: unknown[] = [];
  const ticketUpdates: unknown[] = [];
  const events: unknown[] = [];

  const db = {
    ticket: {
      findMany: async () => [
        {
          id: ticket.id,
          code: ticket.code,
          status: ticket.status,
          customerId: ticket.customerId,
          lastMessageAt: ticket.lastMessageAt,
          customer: {
            id: ticket.customerId,
            phone: ticket.phone,
            botPausedAt: null,
          },
          messages: ticket.messages,
        },
      ],
      update: async ({ data }: { data: unknown }) => {
        ticketUpdates.push(data);
        return {};
      },
    },
    ticketMessage: {
      create: async ({ data }: { data: unknown }) => {
        createdMessages.push(data);
        return data;
      },
    },
    ticketEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      },
    },
  };

  return { db, createdMessages, ticketUpdates, events };
}

describe("runIdleConversationFollowupCycle (mock DB+WA)", () => {
  it("nudge: envía WA, persiste mensaje idle_nudge y no cierra", async () => {
    process.env.WARA_IDLE_FOLLOWUP_ENABLED = "true";
    process.env.WARA_IDLE_NUDGE_MS = String(NUDGE_MS);
    process.env.WARA_IDLE_CLOSE_MS = String(CLOSE_MS);

    const now = new Date("2026-08-26T15:00:00.000Z");
    const botAt = new Date(now.getTime() - NUDGE_MS);
    const sent: Array<{ number: string; message: string }> = [];
    const { db, createdMessages, ticketUpdates, events } = makeMockDb({
      id: "t1",
      code: "2608261",
      status: "OPEN",
      customerId: "c1",
      phone: "5491100000001",
      lastMessageAt: botAt,
      messages: [
        {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: botAt,
          rawPayload: { source: "whatsapp_turn" },
        },
      ],
    });

    const result = await runIdleConversationFollowupCycle({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: db as any,
      now,
      deps: {
        sendWhatsApp: async (p) => {
          sent.push(p);
          return { ok: true } as never;
        },
        isProtectedPhone: () => false,
        clearPending: async () => undefined,
        reactivateAfterClose: async () => true,
      },
    });

    assert.equal(result.nudged, 1);
    assert.equal(result.closed, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.message, IDLE_NUDGE_MESSAGE);
    assert.equal(
      (createdMessages[0] as { rawPayload: { autoReplyKind: string } }).rawPayload.autoReplyKind,
      IDLE_NUDGE_KIND,
    );
    assert.equal(ticketUpdates.length, 1);
    assert.equal(events.length, 1);
  });

  it("close a 30m: envía cierre, RESOLVED y limpia pending", async () => {
    process.env.WARA_IDLE_FOLLOWUP_ENABLED = "true";
    process.env.WARA_IDLE_NUDGE_MS = String(NUDGE_MS);
    process.env.WARA_IDLE_CLOSE_MS = String(CLOSE_MS);

    const now = new Date("2026-08-26T15:00:00.000Z");
    const botAt = new Date(now.getTime() - CLOSE_MS);
    const nudgeAt = new Date(now.getTime() - 15 * 60 * 1000);
    const sent: string[] = [];
    let clearedPhone: string | null = null;
    const { db, ticketUpdates, createdMessages } = makeMockDb({
      id: "t2",
      code: "2608262",
      status: "OPEN",
      customerId: "c2",
      phone: "5491100000002",
      lastMessageAt: nudgeAt,
      messages: [
        {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: nudgeAt,
          rawPayload: { autoReplyKind: IDLE_NUDGE_KIND },
        },
        {
          direction: "OUTBOUND",
          from: "BOT",
          createdAt: botAt,
          rawPayload: { source: "whatsapp_turn" },
        },
      ],
    });

    const result = await runIdleConversationFollowupCycle({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: db as any,
      now,
      deps: {
        sendWhatsApp: async (p) => {
          sent.push(p.message);
          return { ok: true } as never;
        },
        isProtectedPhone: () => false,
        clearPending: async (_db, phone) => {
          clearedPhone = phone;
        },
        reactivateAfterClose: async () => true,
      },
    });

    assert.equal(result.closed, 1);
    assert.equal(result.nudged, 0);
    assert.equal(sent[0], IDLE_CLOSE_MESSAGE);
    assert.equal(
      (createdMessages[0] as { rawPayload: { autoReplyKind: string } }).rawPayload.autoReplyKind,
      IDLE_CLOSE_KIND,
    );
    assert.equal(clearedPhone, "5491100000002");
    assert.ok(
      ticketUpdates.some(
        (u) => (u as { status?: string; resolution?: string }).status === "RESOLVED",
      ),
    );
  });

  it("si falla el envío WA, no persiste ni cierra", async () => {
    process.env.WARA_IDLE_FOLLOWUP_ENABLED = "true";
    const now = new Date("2026-08-26T15:00:00.000Z");
    const botAt = new Date(now.getTime() - NUDGE_MS);
    const { db, createdMessages, ticketUpdates } = makeMockDb({
      id: "t3",
      code: "2608263",
      status: "OPEN",
      customerId: "c3",
      phone: "5491100000003",
      lastMessageAt: botAt,
      messages: [{ direction: "OUTBOUND", from: "BOT", createdAt: botAt, rawPayload: {} }],
    });

    const result = await runIdleConversationFollowupCycle({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: db as any,
      now,
      deps: {
        sendWhatsApp: async () => {
          throw new Error("bbc down");
        },
        isProtectedPhone: () => false,
        clearPending: async () => undefined,
        reactivateAfterClose: async () => true,
      },
    });

    assert.equal(result.errors, 1);
    assert.equal(result.nudged, 0);
    assert.equal(createdMessages.length, 0);
    assert.equal(ticketUpdates.length, 0);
  });
});
