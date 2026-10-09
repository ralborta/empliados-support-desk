import { NextRequest, NextResponse } from "next/server";
import { runIdleConversationFollowupCycle } from "@/lib/idleConversationFollowup";

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Cron: nudge (~15 min) y cierre (~30 min) por inactividad del cliente tras Atilio.
 * Vars: CRON_SECRET, WARA_IDLE_FOLLOWUP_ENABLED, WARA_IDLE_NUDGE_MS, WARA_IDLE_CLOSE_MS
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const result = await runIdleConversationFollowupCycle();
  return NextResponse.json({ ok: true, ...result });
}
