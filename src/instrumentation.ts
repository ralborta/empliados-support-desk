/**
 * Hook de arranque Next.js (Node runtime). Activa crons in-process en EasyPanel.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { startBbcHealthInProcessCron } = await import(
    "@/lib/bbcHealthInProcessCron"
  );
  startBbcHealthInProcessCron();
  const { startIdleFollowupInProcessCron } = await import(
    "@/lib/idleConversationFollowupInProcessCron"
  );
  startIdleFollowupInProcessCron();
}
