import { requireSession } from "@/lib/auth";
import { statusLabels, priorityLabels } from "@/lib/tickets";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { TicketsTable } from "@/components/tickets/TicketsTable";
import { Sparkline } from "@/components/ui/Sparkline";
import { DonutChart } from "@/components/ui/DonutChart";
import { priorityDonutColor, statusBarColor } from "@/lib/ui/badges";
import { prisma } from "@/lib/db";
import Link from "next/link";

async function getDashboardStats() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const [
      totalTickets,
      ticketsByStatus,
      ticketsByPriority,
      ticketsToday,
      ticketsYesterday,
      resolvedToday,
      resolvedYesterday,
      openCount,
      inProgressCount,
      urgentUnassigned,
      recentTickets,
      resolvedTickets,
    ] = await Promise.all([
      prisma.ticket.count(),
      prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
      prisma.ticket.count({ where: { createdAt: { gte: today } } }),
      prisma.ticket.count({
        where: { createdAt: { gte: yesterday, lt: today } },
      }),
      prisma.ticket.count({
        where: { status: "RESOLVED", updatedAt: { gte: today } },
      }),
      prisma.ticket.count({
        where: { status: "RESOLVED", updatedAt: { gte: yesterday, lt: today } },
      }),
      prisma.ticket.count({ where: { status: "OPEN" } }),
      prisma.ticket.count({ where: { status: "IN_PROGRESS" } }),
      prisma.ticket.count({
        where: {
          priority: "URGENT",
          assignedToUserId: null,
          status: { notIn: ["RESOLVED", "CLOSED"] },
        },
      }),
      prisma.ticket.findMany({
        select: {
          id: true,
          code: true,
          title: true,
          contactName: true,
          status: true,
          priority: true,
          lastMessageAt: true,
          createdAt: true,
          customer: {
            select: { name: true, companyName: true, licensePlate: true, phone: true },
          },
          assignedTo: { select: { name: true } },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 8,
      }),
      prisma.ticket.findMany({
        where: { status: { in: ["RESOLVED", "CLOSED"] } },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);

    const avgResolutionTime =
      resolvedTickets.length > 0
        ? resolvedTickets.reduce((acc, t) => {
            const diff = t.updatedAt.getTime() - t.createdAt.getTime();
            return acc + diff / (1000 * 60 * 60);
          }, 0) / resolvedTickets.length
        : 0;

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      const count = await prisma.ticket.count({
        where: { createdAt: { gte: date, lt: nextDate } },
      });
      last7Days.push({ date: date.toISOString().split("T")[0], count });
    }

    return {
      totalTickets,
      ticketsToday,
      ticketsYesterday,
      resolvedToday,
      resolvedYesterday,
      openCount,
      inProgressCount,
      avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
      urgentUnassigned,
      ticketsByStatus: ticketsByStatus.map((s) => ({
        status: s.status,
        count: s._count._all,
      })),
      ticketsByPriority: ticketsByPriority.map((p) => ({
        priority: p.priority,
        count: p._count._all,
      })),
      last7Days,
      recentTickets,
    };
  } catch (error) {
    console.error("[Dashboard] Error al cargar stats:", error);
    return null;
  }
}

function pctChange(today: number, yesterday: number): string {
  if (yesterday === 0) return today > 0 ? "+100%" : "0%";
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function formatAvgHours(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  if (hours === 0) return `${mins}m`;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default async function DashboardPage() {
  await requireSession();
  const stats = await getDashboardStats();

  if (!stats) {
    return (
      <TicketsLayout>
        <p className="text-slate-600">Error al cargar estadísticas.</p>
      </TicketsLayout>
    );
  }

  const sparkData = stats.last7Days.map((d) => d.count);
  const prioritySegments = stats.ticketsByPriority.map((p) => ({
    value: p.count,
    color: priorityDonutColor(p.priority),
    label: priorityLabels[p.priority as keyof typeof priorityLabels],
  }));

  return (
    <TicketsLayout urgentCount={stats.urgentUnassigned}>
      {stats.urgentUnassigned > 0 ? (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-lg" aria-hidden>
            🚨
          </span>
          <p className="text-sm font-medium text-red-800">
            {stats.urgentUnassigned} ticket(s) urgente(s) sin asignar —{" "}
            <Link href="/tickets/urgentes" className="underline hover:no-underline">
              ver urgentes
            </Link>
          </p>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total Tickets"
          value={stats.totalTickets}
          delta={pctChange(stats.ticketsToday, stats.ticketsYesterday)}
          sparkColor="#6366f1"
          spark={sparkData}
        />
        <StatCard
          label="Abiertos"
          value={stats.openCount}
          delta={`${stats.openCount} activos`}
          sparkColor="#3b82f6"
          spark={sparkData}
        />
        <StatCard
          label="En Progreso"
          value={stats.inProgressCount}
          delta={`${stats.inProgressCount} en curso`}
          sparkColor="#f59e0b"
          spark={sparkData}
        />
        <StatCard
          label="Resueltos Hoy"
          value={stats.resolvedToday}
          delta={pctChange(stats.resolvedToday, stats.resolvedYesterday)}
          sparkColor="#22c55e"
          spark={sparkData}
        />
        <StatCard
          label="Tiempo Promedio"
          value={formatAvgHours(stats.avgResolutionTime)}
          delta="resolución"
          sparkColor="#8b5cf6"
          spark={sparkData}
          isText
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">Tickets Recientes</h2>
              <Link href="/tickets" className="text-sm font-medium text-violet-600 hover:text-violet-800">
                Ver todos →
              </Link>
            </div>
            <TicketsTable
              compact
              tickets={stats.recentTickets.map((t) => ({
                ...t,
                lastMessageAt: t.lastMessageAt.toISOString(),
                createdAt: t.createdAt.toISOString(),
              }))}
            />
          </div>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <Widget title="Tickets por Prioridad">
            <DonutChart segments={prioritySegments} />
          </Widget>

          <Widget title="Tickets por Estado">
            <div className="space-y-3">
              {stats.ticketsByStatus.map((item) => (
                <ProgressRow
                  key={item.status}
                  label={statusLabels[item.status as keyof typeof statusLabels]}
                  value={item.count}
                  total={stats.totalTickets}
                  color={statusBarColor(item.status)}
                />
              ))}
            </div>
          </Widget>

          <Widget title="Actividad Últimos 7 Días">
            <div className="flex h-36 items-end justify-between gap-1.5">
              {stats.last7Days.map((day) => {
                const maxCount = Math.max(...stats.last7Days.map((d) => d.count), 1);
                const height = (day.count / maxCount) * 100;
                return (
                  <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] font-semibold text-slate-600">{day.count}</span>
                    <div
                      className="w-full rounded-t-md bg-violet-400 transition-all"
                      style={{ height: `${Math.max(height, 4)}%`, minHeight: day.count > 0 ? 8 : 4 }}
                    />
                    <span className="text-[10px] text-slate-400">
                      {new Date(day.date).toLocaleDateString("es", { weekday: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </Widget>
        </div>
      </div>
    </TicketsLayout>
  );
}

function StatCard({
  label,
  value,
  delta,
  sparkColor,
  spark,
  isText,
}: {
  label: string;
  value: string | number;
  delta: string;
  sparkColor: string;
  spark: number[];
  isText?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={`font-bold text-slate-900 ${isText ? "text-xl" : "text-2xl"}`}>{value}</p>
        <Sparkline data={spark} color={sparkColor} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{delta} vs ayer</p>
    </div>
  );
}

function Widget({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function ProgressRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
