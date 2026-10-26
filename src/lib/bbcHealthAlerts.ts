import type { BbcCronHealthCycleResult, BbcStatusTransition } from "@/lib/bbcRuntimeMonitor";
import {
  markBbcAlertSent,
  shouldSendBbcTransitionAlert,
} from "@/lib/bbcRuntimeMonitor";
import { sendBbcTransitionAlertEmail } from "@/lib/panelEmail";

/** Envía emails de alerta BBC para el ciclo (cooldown compartido). */
export async function sendBbcCycleAlerts(
  cycle: BbcCronHealthCycleResult,
): Promise<boolean> {
  const lastAlertAt = cycle.status.lastAlertAt
    ? new Date(cycle.status.lastAlertAt)
    : null;
  const alertKinds = cycle.alertKinds;
  if (!alertKinds.length) return false;

  const mayAlert = shouldSendBbcTransitionAlert({
    transition: {
      previousStatus: cycle.transition.previousStatus,
      nextStatus: cycle.transition.nextStatus,
      changed: true,
      alertKind: alertKinds[0]!,
    },
    lastAlertAt,
  });
  if (!mayAlert) return false;

  let emailed = false;
  const probeMessage = [
    cycle.deploy?.message,
    cycle.messaging.message,
    cycle.silence.detected ? cycle.silence.detail : null,
    cycle.reboot.attempted
      ? `Auto-reboot: ${cycle.reboot.ok ? "OK" : "FALLÓ"} (${cycle.reboot.message ?? ""})`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  for (const kind of alertKinds) {
    const transition: BbcStatusTransition = {
      previousStatus: cycle.transition.previousStatus,
      nextStatus: cycle.transition.nextStatus,
      changed: true,
      alertKind: kind,
    };
    const sent = await sendBbcTransitionAlertEmail({
      bbc: cycle.status,
      transition,
      probeMessage,
    });
    if (sent) emailed = true;
  }
  if (emailed) await markBbcAlertSent();
  return emailed;
}
