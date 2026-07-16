import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import {
  getUnreadNotificationCount,
  isDbAgentUserId,
  processScheduledAdvisorReleases,
} from "@/lib/advisorDistribution";

export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  await processScheduledAdvisorReleases();

  const userId = auth.session.user!.id;
  if (!isDbAgentUserId(userId)) {
    return NextResponse.json({ notifications: [], unreadCount: 0 });
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.agentNotification.findMany({
      where: { agentUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        ticket: {
          select: {
            id: true,
            code: true,
            title: true,
            priority: true,
            status: true,
            customer: { select: { companyName: true, name: true } },
          },
        },
      },
    }),
    getUnreadNotificationCount(userId),
  ]);

  return NextResponse.json({
    unreadCount,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
      ticket: n.ticket,
    })),
  });
}

export async function POST() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const userId = auth.session.user!.id;
  if (!isDbAgentUserId(userId)) {
    return NextResponse.json({ ok: true });
  }

  await prisma.agentNotification.updateMany({
    where: { agentUserId: userId, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
