import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { TicketsTable } from "@/components/tickets/TicketsTable";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export default async function TicketsPage() {
  await requireSession();

  const tickets = await prisma.ticket.findMany({
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
        select: {
          name: true,
          phone: true,
        },
      },
      assignedTo: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });

  const [statusCounts, priorityCounts, totalCount] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
    prisma.ticket.count(),
  ]);

  const statusCountMap = Object.fromEntries(
    statusCounts.map((c: { status: string; _count: { _all: number } }) => [c.status as TicketStatus, c._count._all])
  ) as Partial<Record<TicketStatus, number>>;
  const priorityCountMap = Object.fromEntries(
    priorityCounts.map((c: { priority: string; _count: { _all: number } }) => [c.priority as TicketPriority, c._count._all])
  ) as Partial<Record<TicketPriority, number>>;

  return (
    <TicketsLayout>
      <div className="w-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 flex items-center gap-3">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-700 to-rose-600 text-white shadow-lg">
                🎫
              </span>
              Todos los Tickets
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Vista general de <span className="font-semibold text-rose-700">{totalCount}</span>{" "}
              {totalCount === 1 ? "ticket" : "tickets"} en el sistema
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Abiertos"
            value={statusCountMap.OPEN || 0}
            color="stone"
            icon="📋"
            description="Tickets pendientes de atención"
          />
          <SummaryCard
            label="En Progreso"
            value={statusCountMap.IN_PROGRESS || 0}
            color="amber"
            icon="⚙️"
            description="Siendo atendidos actualmente"
          />
          <SummaryCard
            label="Esperando Cliente"
            value={statusCountMap.WAITING_CUSTOMER || 0}
            color="sky"
            icon="⏳"
            description="Aguardando respuesta"
          />
          <SummaryCard
            label="Urgentes"
            value={priorityCountMap.URGENT || 0}
            color="rose"
            icon="🚨"
            description="Requieren atención inmediata"
          />
        </div>

        <TicketsTable
          tickets={tickets.map((t) => ({
            ...t,
            lastMessageAt: t.lastMessageAt.toISOString(),
            createdAt: t.createdAt.toISOString(),
          }))}
        />
      </div>
    </TicketsLayout>
  );
}

function SummaryCard({
  label,
  value,
  color,
  icon,
  description,
}: {
  label: string;
  value: number;
  color: string;
  icon?: string;
  description?: string;
}) {
  const colorClasses: Record<string, { bg: string; text: string; ring: string; iconBg: string }> = {
    stone: {
      bg: "bg-gradient-to-br from-stone-50 to-stone-100",
      text: "text-stone-700",
      ring: "ring-stone-200",
      iconBg: "bg-stone-500",
    },
    amber: {
      bg: "bg-gradient-to-br from-amber-50 to-amber-100",
      text: "text-amber-700",
      ring: "ring-amber-200",
      iconBg: "bg-amber-500",
    },
    sky: {
      bg: "bg-gradient-to-br from-sky-50 to-sky-100",
      text: "text-sky-700",
      ring: "ring-sky-200",
      iconBg: "bg-sky-500",
    },
    rose: {
      bg: "bg-gradient-to-br from-rose-50 to-rose-100",
      text: "text-rose-700",
      ring: "ring-rose-200",
      iconBg: "bg-rose-500",
    },
  };

  const colors = colorClasses[color] || colorClasses.stone;

  return (
    <div className={`rounded-2xl p-6 ring-2 ${colors.bg} ${colors.ring} shadow-md hover:shadow-lg transition-all`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl ${colors.iconBg} flex items-center justify-center text-2xl shadow-lg`}>
          {icon || "📊"}
        </div>
      </div>
      <div className="space-y-1">
        <div className={`text-sm font-semibold ${colors.text} uppercase tracking-wide`}>{label}</div>
        <div className="text-4xl font-bold text-slate-900">{value}</div>
        {description && <div className="text-xs text-slate-600 mt-2">{description}</div>}
      </div>
    </div>
  );
}
