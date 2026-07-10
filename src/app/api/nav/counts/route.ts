import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  await requireSession();

  const [byStatus, byPriority] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
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
