import { requireSession } from "@/lib/auth";
import { statusLabels, priorityLabels } from "@/lib/tickets";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";

async function getDashboardStats() {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
  
  const res = await fetch(`${baseUrl}/api/dashboard/stats`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  return res.json();
}

export default async function DashboardPage() {
  await requireSession();
  const stats = await getDashboardStats();

  if (!stats) {
    return (
      <TicketsLayout>
        <div className="mx-auto max-w-7xl">
          <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-4 text-slate-600">Error al cargar estadísticas.</p>
        </div>
      </TicketsLayout>
    );
  }

  return (
    <TicketsLayout>
      <div className="mx-auto max-w-7xl bg-slate-50">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">📊 Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Vista general del sistema de tickets
          </p>
        </div>

        {/* KPIs principales */}
        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Total Tickets"
            value={stats.totalTickets}
            icon="🎫"
            color="bg-blue-50 text-blue-600"
          />
          <KPICard
            title="Creados Hoy"
            value={stats.ticketsToday}
            icon="📥"
            color="bg-emerald-50 text-emerald-600"
          />
          <KPICard
            title="Resueltos Hoy"
            value={stats.resolvedToday}
            icon="✅"
            color="bg-green-50 text-green-600"
          />
          <KPICard
            title="Tiempo Promedio"
            value={`${stats.avgResolutionTime}h`}
            icon="⏱️"
            color="bg-amber-50 text-amber-600"
          />
        </div>

        {/* Alerta de urgentes */}
        {stats.urgentUnassigned > 0 && (
          <div className="mb-8 rounded-2xl bg-rose-50 p-6 shadow-sm ring-1 ring-rose-200">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚨</span>
              <div>
                <h3 className="font-semibold text-rose-900">
                  ¡Atención! {stats.urgentUnassigned} ticket(s) urgente(s) sin asignar
                </h3>
                <p className="text-sm text-rose-700">
                  Requieren atención inmediata
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Grid principal */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Tickets por Estado */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              📋 Tickets por Estado
            </h2>
            <div className="space-y-3">
              {stats.ticketsByStatus.map((item: any) => (
                <ProgressBar
                  key={item.status}
                  label={statusLabels[item.status as keyof typeof statusLabels]}
                  value={item.count}
                  total={stats.totalTickets}
                  color={getStatusColor(item.status)}
                />
              ))}
            </div>
          </div>

          {/* Tickets por Prioridad */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              🔥 Tickets por Prioridad
            </h2>
            <div className="space-y-3">
              {stats.ticketsByPriority.map((item: any) => (
                <ProgressBar
                  key={item.priority}
                  label={priorityLabels[item.priority as keyof typeof priorityLabels]}
                  value={item.count}
                  total={stats.totalTickets}
                  color={getPriorityColor(item.priority)}
                />
              ))}
            </div>
          </div>

          {/* Tendencia últimos 7 días */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              📈 Últimos 7 días
            </h2>
            <div className="flex items-end justify-between gap-2 h-48">
              {stats.last7Days.map((day: any) => {
                const maxCount = Math.max(...stats.last7Days.map((d: any) => d.count));
                const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
                return (
                  <div key={day.date} className="flex flex-col items-center flex-1">
                    <div className="text-xs font-semibold text-slate-700 mb-1">
                      {day.count}
                    </div>
                    <div
                      className="w-full bg-indigo-500 rounded-t-lg transition-all"
                      style={{ height: `${height}%`, minHeight: day.count > 0 ? "8px" : "2px" }}
                    />
                    <div className="mt-2 text-xs text-slate-500">
                      {new Date(day.date).toLocaleDateString("es", { weekday: "short" })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Agentes */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              👥 Top Agentes
            </h2>
            <div className="space-y-3">
              {stats.topAgents.length === 0 ? (
                <p className="text-sm text-slate-500">No hay agentes con tickets asignados.</p>
              ) : (
                stats.topAgents.map((agent: any, index: number) => (
                  <div key={agent.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
                        #{index + 1}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-slate-900">{agent.name}</div>
                        <div className="text-xs text-slate-500">{agent.email}</div>
                      </div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                      {agent.activeTickets}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Top Empresas */}
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              🏢 Top Empresas con más Tickets
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {stats.topCompanies.length === 0 ? (
                <p className="text-sm text-slate-500">No hay datos disponibles.</p>
              ) : (
                stats.topCompanies.map((company: any, index: number) => (
                  <div
                    key={company.id}
                    className="rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-md transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">#{index + 1}</span>
                      <span className="text-xl font-bold text-indigo-600">
                        {company.totalTickets}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {company.name}
                    </div>
                    <div className="text-xs text-slate-500">{company.phone}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </TicketsLayout>
  );
}

function KPICard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  icon: string;
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${color}`}>
          <span className="text-2xl">{icon}</span>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
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
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-600">{value}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case "OPEN":
      return "bg-blue-500";
    case "IN_PROGRESS":
      return "bg-amber-500";
    case "WAITING_CUSTOMER":
      return "bg-lime-500";
    case "RESOLVED":
      return "bg-emerald-500";
    case "CLOSED":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case "URGENT":
      return "bg-rose-500";
    case "HIGH":
      return "bg-amber-500";
    case "NORMAL":
      return "bg-emerald-500";
    case "LOW":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}
