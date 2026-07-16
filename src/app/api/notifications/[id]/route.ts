import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/apiAuth";
import { prisma } from "@/lib/db";
import { isDbAgentUserId } from "@/lib/advisorDistribution";

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const userId = auth.session.user!.id;
  if (!isDbAgentUserId(userId)) {
    return NextResponse.json({ error: "No aplica" }, { status: 400 });
  }

  const { id } = await params;
  await prisma.agentNotification.updateMany({
    where: { id, agentUserId: userId },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
