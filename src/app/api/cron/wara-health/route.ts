import { NextRequest, NextResponse } from "next/server";
import { checkWaraApiHealth } from "@/lib/waraHealthCheck";
import { sendWaraHealthAlertEmail } from "@/lib/panelEmail";

export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Cron (Vercel): revisa conectividad con Wara y avisa por email si falla.
 * Variables: CRON_SECRET, WARA_OPS_ALERT_EMAIL (comma-separated)
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const health = await checkWaraApiHealth();
  let emailed = false;

  if (!health.healthy) {
    emailed = await sendWaraHealthAlertEmail(health);
  }

  return NextResponse.json({
    ok: health.healthy,
    emailed,
    health,
  });
}
