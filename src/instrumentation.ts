/**
 * Hook de arranque Next.js (Node runtime). Activa cron BBC in-process en EasyPanel.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { startBbcHealthInProcessCron } = await import(
    "@/lib/bbcHealthInProcessCron"
  );
  startBbcHealthInProcessCron();
}
