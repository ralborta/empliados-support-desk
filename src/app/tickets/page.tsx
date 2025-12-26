import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  priorityLabels,
  statusLabels
} from "@/lib/tickets";
type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

function statusBadgeClass(status: TicketStatus) {
  switch (status) {
    case "OPEN":
      return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS":
      return "bg-amber-100 text-amber-800";
    case "WAITING_CUSTOMER":
      return "bg-lime-100 text-lime-800";
    case "RESOLVED":
      return "bg-emerald-100 text-emerald-800";
    case "CLOSED":
      return "bg-slate-200 text-slate-700";
  }
}

function priorityBadgeClass(priority: TicketPriority) {
  switch (priority) {
    case "URGENT":
      return "bg-rose-100 text-rose-800";
    case "HIGH":
      return "bg-amber-100 text-amber-800";
    case "NORMAL":
      return "bg-emerald-100 text-emerald-800";
    case "LOW":
      return "bg-slate-200 text-slate-700";
  }
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await requireSession();

  const statusFilter = (searchParams.status as TicketStatus | undefined) || undefined;
  const priorityFilter = (searchParams.priority as TicketPriority | undefined) || undefined;
  const query = (searchParams.q as string | undefined) || "";

  const where = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
    ...(query
      ? {
          OR: [
            { code: { contains: query, mode: "insensitive" } },
            { title: { contains: query, mode: "insensitive" } },
            { customer: { phone: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  } satisfies Parameters<typeof prisma.ticket.findMany>[0]["where"];

  const [tickets, statusCounts, priorityCounts] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: { customer: true, assignedTo: true },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    }),
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
  ]);

  const statusCountMap = Object.fromEntries(
    statusCounts.map((c: { status: string; _count: { _all: number } }) => [c.status as TicketStatus, c._count._all])
  ) as Partial<Record<TicketStatus, number>>;
  const priorityCountMap = Object.fromEntries(
    priorityCounts.map((c: { priority: string; _count: { _all: number } }) => [c.priority as TicketPriority, c._count._all])
  ) as Partial<Record<TicketPriority, number>>;

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-slate-800 text-white shadow-lg">
        <div className="flex items-center gap-3 px-6 py-5 text-lg font-semibold">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
            🎧
          </span>
          <span>Soporte</span>
        </div>
        <nav className="space-y-1 px-2 pb-6 text-sm">
          <SectionTitle>Todos los Tickets</SectionTitle>
          <NavLink label="Abiertos" href="/tickets?status=OPEN" active={statusFilter === "OPEN"} />
          <NavLink label="En Progreso" href="/tickets?status=IN_PROGRESS" active={statusFilter === "IN_PROGRESS"} />
          <NavLink label="Esperando Cliente" href="/tickets?status=WAITING_CUSTOMER" active={statusFilter === "WAITING_CUSTOMER"} />
          <NavLink label="Resueltos" href="/tickets?status=RESOLVED" active={statusFilter === "RESOLVED"} />
          <NavLink label="Cerrados" href="/tickets?status=CLOSED" active={statusFilter === "CLOSED"} />
          <SectionTitle>Prioridad</SectionTitle>
          <NavLink label="Urgente" href="/tickets?priority=URGENT" active={priorityFilter === "URGENT"} indicator="bg-rose-500" />
          <NavLink label="Alta" href="/tickets?priority=HIGH" active={priorityFilter === "HIGH"} indicator="bg-amber-500" />
          <NavLink label="Normal" href="/tickets?priority=NORMAL" active={priorityFilter === "NORMAL"} indicator="bg-emerald-500" />
          <NavLink label="Baja" href="/tickets?priority=LOW" active={priorityFilter === "LOW"} indicator="bg-slate-400" />
        </nav>
      </aside>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Tickets de Soporte</h1>
              <p className="text-sm text-slate-500">Builderbot maneja el triage, el backend decide el plan</p>
            </div>
            <form className="flex w-64 items-center gap-2" method="get">
              <input
                type="text"
                name="q"
                placeholder="Buscar..."
                defaultValue={query}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none"
              />
              {statusFilter ? <input type="hidden" name="status" value={statusFilter} /> : null}
              {priorityFilter ? <input type="hidden" name="priority" value={priorityFilter} /> : null}
            </form>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Abiertos" value={statusCountMap.OPEN || 0} />
            <SummaryCard label="En Progreso" value={statusCountMap.IN_PROGRESS || 0} />
            <SummaryCard label="Esperando Cliente" value={statusCountMap.WAITING_CUSTOMER || 0} />
            <SummaryCard label="Urgentes" value={priorityCountMap.URGENT || 0} />
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="grid grid-cols-12 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <div className="col-span-2">ID</div>
              <div className="col-span-3">Asunto</div>
              <div className="col-span-2">Cliente</div>
              <div className="col-span-2">Estado</div>
              <div className="col-span-2">Prioridad</div>
              <div className="col-span-1">Asignado</div>
            </div>
            <div className="divide-y divide-slate-100">
              {tickets.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">No hay tickets con estos filtros.</div>
              ) : (
                tickets.map((ticket: { id: string; code: string; title: string; status: string; priority: string; customer: { phone?: string; name?: string } | null; assignedTo: { name?: string } | null }) => (
                  <div key={ticket.id} className="grid grid-cols-12 items-center px-4 py-3 hover:bg-slate-50">
                    <div className="col-span-2 text-sm font-semibold text-slate-800">{ticket.code}</div>
                    <div className="col-span-3">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="text-sm font-semibold text-indigo-600 hover:underline"
                      >
                        {ticket.title}
                      </Link>
                      <div className="text-xs text-slate-500">{ticket.customer?.phone}</div>
                    </div>
                    <div className="col-span-2 text-sm text-slate-700">{ticket.customer?.name || "Cliente"}</div>
                    <div className="col-span-2">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(ticket.status as TicketStatus)}`}>
                        {statusLabels[ticket.status as TicketStatus]}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${priorityBadgeClass(ticket.priority as TicketPriority)}`}>
                        {priorityLabels[ticket.priority as TicketPriority]}
                      </span>
                    </div>
                    <div className="col-span-1 text-sm text-slate-700">
                      {ticket.assignedTo?.name || "–"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-2 pt-4 text-xs uppercase text-slate-400">{children}</div>;
}

function NavLink({
  href,
  label,
  active,
  indicator,
}: {
  href: string;
  label: string;
  active?: boolean;
  indicator?: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition hover:bg-white/10 ${
        active ? "bg-white/10 text-white" : "text-slate-200"
      }`}
    >
      {indicator ? <span className={`h-2 w-2 rounded-full ${indicator}`}></span> : null}
      <span>{label}</span>
    </Link>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
