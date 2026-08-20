import { NextRequest, NextResponse } from "next/server";
import {
  getBbcRuntimeStatus,
  probeBbcMessagingApi,
  recordBbcStatusEvent,
} from "@/lib/bbcRuntimeMonitor";
import { sendBbcRuntimeAlertEmail } from "@/lib/panelEmail";

export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Cron: sonda la API de mensajes BBC y alerta si no responde.
 * Los reinicios se detectan mejor por webhook status.ready → /api/whatsapp/inbound.
 *
 * Variables: CRON_SECRET, WARA_OPS_ALERT_EMAIL (o PANEL_USER_ADMIN_EMAIL)
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const probe = await probeBbcMessagingApi();
  let emailed = false;
  let recorded = null as Awaited<ReturnType<typeof recordBbcStatusEvent>> | null;

  if (!probe.ok) {
    recorded = await recordBbcStatusEvent({
      eventName: "status.probe_failed",
      status: "OFFLINE",
      source: "cron_probe",
      raw: probe,
    });
    emailed = await sendBbcRuntimeAlertEmail(recorded);
  }

  const current = recorded ?? (await getBbcRuntimeStatus());

  return NextResponse.json({
    ok: probe.ok,
    emailed,
    probe,
    bbc: current,
  });
}
