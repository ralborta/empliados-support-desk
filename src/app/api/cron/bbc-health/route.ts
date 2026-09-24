import { NextRequest, NextResponse } from "next/server";
import { runBbcHealthCronCycle } from "@/lib/bbcRuntimeMonitor";
import { sendBbcCycleAlerts } from "@/lib/bbcHealthAlerts";

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Cron: sonda deploy Meta/BBC (MCP) + API mensajes + silencio funcional.
 * Alerta en transición; 1 reboot automático ante caída/silencio (cooldown).
 *
 * Variables: CRON_SECRET, BUILDERBOT_BOT_ID, BUILDERBOT_API_KEY,
 * BUILDERBOT_MCP_API_KEY, WARA_BBC_ALERT_EMAIL, WARA_BBC_AUTO_REBOOT
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const cycle = await runBbcHealthCronCycle();
  const emailed = await sendBbcCycleAlerts(cycle);

  return NextResponse.json({
    ok: cycle.status.healthy,
    emailed,
    alertKinds: cycle.alertKinds,
    transition: cycle.transition,
    silence: cycle.silence,
    reboot: cycle.reboot,
    deploy: cycle.deploy
      ? { ok: cycle.deploy.ok, status: cycle.deploy.status, message: cycle.deploy.message }
      : null,
    messaging: cycle.messaging,
    bbc: cycle.status,
  });
}
