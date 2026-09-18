/**
 * Cron in-process: idle follow-up (nudge 15m / close 30m).
 * EasyPanel/Node; en Vercel usá /api/cron/idle-conversation.
 */
import { runIdleConversationFollowupCycle } from "@/lib/idleConversationFollowup";

const INTERVAL_MS = 2 * 60 * 1000;
const BOOT_DELAY_MS = 90_000;

let started = false;

function inProcessCronEnabled(): boolean {
  if (process.env.WARA_IDLE_FOLLOWUP_ENABLED?.trim().toLowerCase() === "false") {
    return false;
  }
  if (process.env.WARA_IDLE_INPROCESS_CRON?.trim().toLowerCase() === "false") {
    return false;
  }
  if (process.env.VERCEL === "1") return false;
  return true;
}

async function tick(): Promise<void> {
  try {
    const result = await runIdleConversationFollowupCycle();
    if (!result.enabled) return;
    if (result.nudged || result.closed || result.errors) {
      console.log("[idleFollowupInProcessCron]", result);
    }
  } catch (error) {
    console.error("[idleFollowupInProcessCron] tick failed:", error);
  }
}

export function startIdleFollowupInProcessCron(): void {
  if (started || !inProcessCronEnabled()) return;
  started = true;
  console.log(
    `[idleFollowupInProcessCron] activo cada ${INTERVAL_MS / 60000} min (EasyPanel/Node)`,
  );
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), INTERVAL_MS);
  }, BOOT_DELAY_MS);
}
