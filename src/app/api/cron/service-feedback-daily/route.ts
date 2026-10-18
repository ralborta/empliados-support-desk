import { NextRequest, NextResponse } from "next/server";
import { runServiceFeedbackDailySummary } from "@/lib/kiraServiceFeedbackDailySummary";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Cron diario: resumen de feedback Kira del día ART anterior → Lucas/Emiliano.
 * Vars: CRON_SECRET, WARA_SERVICE_FEEDBACK_EMAIL (opcional)
 * Query: ?force=1 para reenviar (ignora dedupe)
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const dayKey = req.nextUrl.searchParams.get("day")?.trim() || undefined;
  const result = await runServiceFeedbackDailySummary({ force, dayKey });

  return NextResponse.json({ ok: true, ...result });
}
