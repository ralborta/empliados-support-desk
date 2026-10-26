import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/apiAuth";
import { feedbackRowsToCsv, listServiceFeedback } from "@/lib/kiraServiceFeedbackQuery";

export const dynamic = "force-dynamic";

function parseDayStart(raw: string | null): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(`${raw.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayEnd(raw: string | null): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(`${raw.trim()}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/feedback
 * Listado interno del panel (sesión). ?format=csv para export.
 */
export async function GET(req: Request) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const from = parseDayStart(url.searchParams.get("from"));
  const to = parseDayEnd(url.searchParams.get("to"));
  const minScoreRaw = url.searchParams.get("minScore");
  const maxScoreRaw = url.searchParams.get("maxScore");
  const minScore = minScoreRaw != null && minScoreRaw !== "" ? Number(minScoreRaw) : null;
  const maxScore = maxScoreRaw != null && maxScoreRaw !== "" ? Number(maxScoreRaw) : null;
  const q = url.searchParams.get("q");
  const format = url.searchParams.get("format");

  const result = await listServiceFeedback({
    from,
    to,
    minScore: Number.isFinite(minScore as number) ? minScore : null,
    maxScore: Number.isFinite(maxScore as number) ? maxScore : null,
    q,
    limit: 500,
  });

  if (format === "csv") {
    const csv = feedbackRowsToCsv(result.rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kira-feedback.csv"`,
      },
    });
  }

  return NextResponse.json({
    data: result.rows,
    meta: {
      avgScore: result.avgScore,
      countWithScore: result.countWithScore,
      count: result.rows.length,
    },
  });
}
