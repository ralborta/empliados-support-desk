import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeKpiApi } from "@/lib/kpiApiAuth";
import {
  ADVISOR_ACTIVE_TICKET_STATUSES,
  ADVISOR_PRESENCE_TIMEOUT_MS,
  mapAdvisorToKpiDto,
} from "@/lib/kpiDashboard";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/kpi/advisors
 * Asesores + presencia + carga abierta (solo lectura).
 */
export async function GET(req: Request) {
  const auth = authorizeKpiApi(req);
  if (!auth.ok) return auth.response;

  const agents = await prisma.agentUser.findMany({
    where: { role: { in: ["SUPPORT", "ADMIN"] } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      role: true,
      sessionActive: true,
      lastSeenAt: true,
      presenceStartedAt: true,
      _count: {
        select: {
          tickets: { where: { status: { in: ADVISOR_ACTIVE_TICKET_STATUSES } } },
        },
      },
    },
  });

  return NextResponse.json({
    data: agents.map(mapAdvisorToKpiDto),
    meta: {
      timezone: "UTC",
      presenceTimeoutMs: ADVISOR_PRESENCE_TIMEOUT_MS,
      readOnly: true,
    },
  });
}
