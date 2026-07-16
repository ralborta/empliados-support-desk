import { NextResponse } from "next/server";
import { processScheduledAdvisorReleases } from "@/lib/advisorDistribution";

/** Procesa liberaciones pendientes (gracia 5 min). Puede invocarse por cron Vercel. */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const released = await processScheduledAdvisorReleases();
  return NextResponse.json({ ok: true, released });
}
