/**
 * Cron in-process: resumen diario feedback Kira (~08:00 ART).
 * EasyPanel/Node; en Vercel usá /api/cron/service-feedback-daily.
 */
import {
  isServiceFeedbackDailyHour,
  runServiceFeedbackDailySummary,
} from "@/lib/kiraServiceFeedbackDailySummary";

const INTERVAL_MS = 30 * 60 * 1000;
const BOOT_DELAY_MS = 120_000;

let started = false;

function inProcessCronEnabled(): boolean {
  if (process.env.WARA_SERVICE_FEEDBACK_ENABLED?.trim().toLowerCase() === "false") {
    return false;
  }
  if (process.env.WARA_SERVICE_FEEDBACK_INPROCESS_CRON?.trim().toLowerCase() === "false") {
    return false;
  }
  if (process.env.VERCEL === "1") return false;
  return true;
}

async function tick(): Promise<void> {
  try {
    if (!isServiceFeedbackDailyHour()) return;
    const result = await runServiceFeedbackDailySummary();
    if (!result.skipped || result.reason === "empty") {
      console.log("[kiraFeedbackDailyCron]", result);
    }
  } catch (error) {
    console.error("[kiraFeedbackDailyCron] tick failed:", error);
  }
}

export function startKiraFeedbackDailyInProcessCron(): void {
  if (started || !inProcessCronEnabled()) return;
  started = true;
  console.log(
    `[kiraFeedbackDailyCron] activo cada ${INTERVAL_MS / 60000} min (ventana ~08:00 ART)`,
  );
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), INTERVAL_MS);
  }, BOOT_DELAY_MS);
}
