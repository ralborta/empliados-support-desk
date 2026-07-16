import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { onAdvisorLogout } from "@/lib/advisorDistribution";

export async function POST() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const userId = session.user?.id;
  session.destroy();

  if (userId) {
    try {
      await onAdvisorLogout(userId);
    } catch (e) {
      console.error("[auth/logout] onAdvisorLogout:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
