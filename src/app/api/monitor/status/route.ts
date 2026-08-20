import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ADVISOR_PRESENCE_TIMEOUT_MS, isAdvisorPresentlyOnline } from "@/lib/advisorDistribution";
import { getMonitorRecentActivity } from "@/lib/monitorActivity";
import { getPanelScreenLabel } from "@/lib/panelScreenLabels";
import { checkWaraApiHealth } from "@/lib/waraHealthCheck";
import { getBbcRuntimeStatus, probeBbcMessagingApi } from "@/lib/bbcRuntimeMonitor";

/**
 * Pantalla externa de monitoreo (fuera del login normal del panel): quién está
 * conectado, desde cuándo, en qué pantalla, y actividad reciente de WhatsApp.
 * Protegida por una contraseña propia (MONITOR_ACCESS_PASSWORD), independiente
 * del login de AgentUser — a propósito, para que sea una "vista de solo lectura"
 * separada sin exponer sesiones de panel.
 */
function checkAccess(req: NextRequest): boolean {
  const expected = process.env.MONITOR_ACCESS_PASSWORD?.trim();
  if (!expected) return false;
  const provided =
    req.headers.get("x-monitor-password")?.trim() ||
    new URL(req.url).searchParams.get("password")?.trim() ||
    "";
  return provided === expected;
}

export async function GET(req: NextRequest) {
  if (!checkAccess(req)) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const agents = await prisma.agentUser.findMany({
    where: { role: { in: ["ADMIN", "SUPPORT"] } },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      sessionActive: true,
      lastSeenAt: true,
      presenceStartedAt: true,
      currentPage: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  const rows = agents.map((agent) => {
    const online = isAdvisorPresentlyOnline({
      sessionActive: agent.sessionActive,
      lastSeenAt: agent.lastSeenAt,
    });
    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      online,
      connectedSince: online ? agent.presenceStartedAt : null,
      lastSeenAt: agent.lastSeenAt,
      currentPage: online ? agent.currentPage : null,
      currentPageLabel: online ? getPanelScreenLabel(agent.currentPage) : "—",
    };
  });

  const activity = await getMonitorRecentActivity();
  const wara = await checkWaraApiHealth();
  const bbcStored = await getBbcRuntimeStatus();
  const bbcProbe = await probeBbcMessagingApi();
  const bbc = {
    ...(bbcStored ?? {
      key: "bbc",
      status: bbcProbe.ok ? "UNKNOWN" : "OFFLINE",
      healthy: bbcProbe.ok,
      host: null,
      detail: null,
      lastEventAt: null,
      lastOnlineAt: null,
      lastOfflineAt: null,
      restartCount: 0,
      updatedAt: new Date().toISOString(),
    }),
    apiProbeOk: bbcProbe.ok,
    apiProbeMessage: bbcProbe.message,
    apiProbeHttpStatus: bbcProbe.httpStatus,
  };

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    presenceTimeoutMs: ADVISOR_PRESENCE_TIMEOUT_MS,
    agents: rows,
    activity,
    wara,
    bbc,
  });
}
