import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ServiceFeedbackRow = {
  id: string;
  at: string;
  ticketId: string;
  ticketCode: string;
  cliente: string | null;
  score: number | null;
  comment: string | null;
  stage: string;
};

export type ServiceFeedbackListParams = {
  from?: Date | null;
  to?: Date | null;
  minScore?: number | null;
  maxScore?: number | null;
  q?: string | null;
  limit?: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function scoreFromPayload(p: Record<string, unknown>): number | null {
  const s = p.score;
  if (typeof s === "number" && Number.isFinite(s) && s >= 1 && s <= 10) return s;
  if (typeof s === "string" && /^(10|[1-9])$/.test(s.trim())) return Number(s.trim());
  return null;
}

function rankStage(stage: string): number {
  if (stage === "recorded") return 3;
  if (stage === "awaiting_comment") return 2;
  if (stage === "skipped") return 1;
  return 0;
}

/**
 * Lista feedback de Kira (TicketEvent AUTO_REPLY / service_feedback).
 * Un registro por ticket: prioriza `recorded` > `awaiting_comment` > `skipped` con nota.
 */
export async function listServiceFeedback(
  params: ServiceFeedbackListParams = {},
  client: PrismaClient = prisma,
): Promise<{ rows: ServiceFeedbackRow[]; avgScore: number | null; countWithScore: number }> {
  const limit = Math.min(500, Math.max(1, params.limit ?? 200));
  const from = params.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = params.to ?? new Date();

  const events = await client.ticketEvent.findMany({
    where: {
      type: "AUTO_REPLY",
      createdAt: { gte: from, lte: to },
      payload: { path: ["kind"], equals: "service_feedback" },
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: {
      id: true,
      createdAt: true,
      payload: true,
      ticket: {
        select: {
          id: true,
          code: true,
          customer: { select: { companyName: true, name: true } },
        },
      },
    },
  });

  const byTicket = new Map<
    string,
    {
      id: string;
      at: Date;
      ticketId: string;
      ticketCode: string;
      cliente: string | null;
      score: number | null;
      comment: string | null;
      stage: string;
      rank: number;
    }
  >();

  for (const ev of events) {
    const p = asRecord(ev.payload);
    if (!p || p.kind !== "service_feedback") continue;
    const stage = String(p.stage ?? "");
    const score = scoreFromPayload(p);
    if (score == null && stage !== "recorded") continue;
    if (stage === "awaiting_score" || stage === "aborted") continue;

    const comment =
      typeof p.comment === "string" && p.comment.trim() ? p.comment.trim().slice(0, 800) : null;

    const rank = rankStage(stage);
    const prev = byTicket.get(ev.ticket.id);
    if (prev && prev.rank >= rank) continue;

    byTicket.set(ev.ticket.id, {
      id: ev.id,
      at: ev.createdAt,
      ticketId: ev.ticket.id,
      ticketCode: ev.ticket.code,
      cliente: ev.ticket.customer.companyName ?? ev.ticket.customer.name ?? null,
      score,
      comment,
      stage,
      rank,
    });
  }

  let rows: ServiceFeedbackRow[] = [...byTicket.values()]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      ticketId: r.ticketId,
      ticketCode: r.ticketCode,
      cliente: r.cliente,
      score: r.score,
      comment: r.comment,
      stage: r.stage,
    }));

  if (params.minScore != null) {
    rows = rows.filter((r) => r.score != null && r.score >= params.minScore!);
  }
  if (params.maxScore != null) {
    rows = rows.filter((r) => r.score != null && r.score <= params.maxScore!);
  }
  const q = params.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.cliente ?? "").toLowerCase().includes(q) ||
        r.ticketCode.toLowerCase().includes(q) ||
        (r.comment ?? "").toLowerCase().includes(q),
    );
  }

  const withScore = rows.filter((r) => r.score != null);
  const avgScore =
    withScore.length > 0
      ? withScore.reduce((acc, r) => acc + (r.score ?? 0), 0) / withScore.length
      : null;

  return {
    rows: rows.slice(0, limit),
    avgScore,
    countWithScore: withScore.length,
  };
}

export function feedbackRowsToCsv(rows: ServiceFeedbackRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ["fecha_utc", "ticket", "cliente", "nota", "comentario", "estado"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.at),
        esc(r.ticketCode),
        esc(r.cliente ?? ""),
        r.score == null ? "" : String(r.score),
        esc(r.comment ?? ""),
        esc(r.stage),
      ].join(","),
    );
  }
  return lines.join("\n");
}
