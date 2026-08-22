import { NextRequest, NextResponse } from "next/server";
import {
  markBbcAlertSent,
  persistBbcCronProbe,
  probeBbcMessagingApi,
  shouldSendBbcTransitionAlert,
} from "@/lib/bbcRuntimeMonitor";
import { sendBbcTransitionAlertEmail } from "@/lib/panelEmail";

export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Cron: sonda la API de mensajes BBC, persiste estado y alerta solo en transición.
 * Los reinicios se detectan por webhook status.ready → /api/whatsapp/inbound.
 *
 * Variables: CRON_SECRET, WARA_BBC_ALERT_EMAIL (default ralborta@empliados.net)
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const probe = await probeBbcMessagingApi();
  const { status, transition } = await persistBbcCronProbe({ probe });

  let emailed = false;
  const lastAlertAt = status.lastAlertAt ? new Date(status.lastAlertAt) : null;
  if (
    shouldSendBbcTransitionAlert({
      transition,
      lastAlertAt,
    })
  ) {
    emailed = await sendBbcTransitionAlertEmail({
      bbc: status,
      transition,
      probeMessage: probe.message,
    });
    if (emailed) await markBbcAlertSent();
  }

  return NextResponse.json({
    ok: probe.ok,
    emailed,
    transition,
    probe,
    bbc: status,
  });
}
