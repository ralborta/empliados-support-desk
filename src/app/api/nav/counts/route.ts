import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { applyAdvisorTicketScope, processScheduledAdvisorReleases } from "@/lib/advisorDistribution";

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await processScheduledAdvisorReleases();

  const where = applyAdvisorTicketScope({}, session.user);

  const [byStatus, byPriority] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priority"], where, _count: { _all: true } }),
  ]);

  const status: Record<string, number> = {};
  for (const row of byStatus) {
    status[row.status] = row._count._all;
  }

  const priority: Record<string, number> = {};
  for (const row of byPriority) {
    priority[row.priority] = row._count._all;
  }

  return NextResponse.json({ status, priority });
}
