/**
 * Cron in-process para EasyPanel (Node largo). En Vercel se usa vercel.json.
 * Llama el mismo ciclo que /api/cron/bbc-health.
 */
import { runBbcHealthCronCycle } from "@/lib/bbcRuntimeMonitor";
import { sendBbcCycleAlerts } from "@/lib/bbcHealthAlerts";

const INTERVAL_MS = 5 * 60 * 1000;
const BOOT_DELAY_MS = 45_000;

let started = false;

function inProcessCronEnabled(): boolean {
  if (process.env.WARA_BBC_INPROCESS_CRON?.trim().toLowerCase() === "false") {
    return false;
  }
  // Vercel Cron cubre el schedule; evitar doble ejecución.
  if (process.env.VERCEL === "1") return false;
  return true;
}

async function tick(): Promise<void> {
  try {
    const cycle = await runBbcHealthCronCycle();
    const emailed = await sendBbcCycleAlerts(cycle);
    console.log("[bbcHealthInProcessCron]", {
      healthy: cycle.status.healthy,
      status: cycle.status.status,
      silence: cycle.silence.detected,
      reboot: cycle.reboot.attempted
        ? cycle.reboot.ok
          ? "ok"
          : "failed"
        : "skip",
      emailed,
      alertKinds: cycle.alertKinds,
    });
  } catch (error) {
    console.error("[bbcHealthInProcessCron] tick failed:", error);
  }
}

export function startBbcHealthInProcessCron(): void {
  if (started || !inProcessCronEnabled()) return;
  started = true;
  console.log(
    `[bbcHealthInProcessCron] activo cada ${INTERVAL_MS / 60000} min (EasyPanel/Node)`,
  );
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), INTERVAL_MS);
  }, BOOT_DELAY_MS);
}
