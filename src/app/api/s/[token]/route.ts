import { NextRequest, NextResponse } from "next/server";
import { getSurveyByToken, submitSurveyByToken } from "@/lib/serviceFeedbackSurvey";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const found = await getSurveyByToken(token);
  if (!found) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    stage: found.payload.stage,
    ticketCode: found.ticket?.code ?? null,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const resolvedRaw = body.resolved;
  const resolved =
    resolvedRaw === true || resolvedRaw === "true" || resolvedRaw === "yes" || resolvedRaw === "si"
      ? true
      : resolvedRaw === false ||
          resolvedRaw === "false" ||
          resolvedRaw === "no"
        ? false
        : null;

  const scoreNum = Number(body.score);
  const score = Number.isInteger(scoreNum) ? scoreNum : null;
  const comment = typeof body.comment === "string" ? body.comment : null;

  if (score == null || score < 1 || score > 10) {
    return NextResponse.json(
      { ok: false, error: "score_required" },
      { status: 400 },
    );
  }

  const result = await submitSurveyByToken({ token, resolved, score, comment });
  if (!result.ok) {
    const status =
      result.error === "not_found"
        ? 404
        : result.error === "expired" || result.error === "already_completed"
          ? 409
          : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ ok: true });
}
