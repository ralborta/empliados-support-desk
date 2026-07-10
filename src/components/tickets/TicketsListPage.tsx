import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { TicketsTable } from "@/components/tickets/TicketsTable";
import { TicketsPageToolbar } from "@/components/tickets/TicketsPageToolbar";
import { Pagination } from "@/components/ui/Pagination";
import { MergeDuplicateOpenTicketsButton } from "@/components/tickets/MergeDuplicateOpenTicketsButton";
import { FilteredPageHeader } from "@/components/tickets/FilteredPageHeader";
import {
  buildPageHref,
  buildTicketWhere,
  parseTicketListPage,
  TICKETS_PAGE_SIZE,
  ticketListSelect,
  type TicketListFixedFilter,
  type TicketListSearchParams,
} from "@/lib/ticketListQuery";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

interface StatCard {
  label: string;
  value: number | string;
  color: string;
}

interface TicketsListPageProps {
  basePath: string;
  title: string;
  subtitle?: string;
  searchParams: TicketListSearchParams;
  fixedFilter?: TicketListFixedFilter;
  showToolbar?: boolean;
  showMergeButton?: boolean;
  highlightStat?: { label: string; color: string };
}

export async function TicketsListPage({
  basePath,
  title,
  subtitle,
  searchParams,
  fixedFilter,
  showToolbar = false,
  showMergeButton = false,
  highlightStat,
}: TicketsListPageProps) {
  const session = await requireSession();
  const page = parseTicketListPage(searchParams.page);
  const where = buildTicketWhere(searchParams, fixedFilter);

  const [tickets, filteredCount, statusCounts, priorityCounts, totalCount, agentes] =
    await Promise.all([
      prisma.ticket.findMany({
        where,
        select: ticketListSelect,
        orderBy: { lastMessageAt: "desc" },
        skip: (page - 1) * TICKETS_PAGE_SIZE,
        take: TICKETS_PAGE_SIZE,
      }),
      prisma.ticket.count({ where }),
      prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
      prisma.ticket.count(),
      prisma.agentUser.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / TICKETS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const statusCountMap = Object.fromEntries(
    statusCounts.map((c) => [c.status as TicketStatus, c._count._all])
  ) as Partial<Record<TicketStatus, number>>;
  const priorityCountMap = Object.fromEntries(
    priorityCounts.map((c) => [c.priority as TicketPriority, c._count._all])
  ) as Partial<Record<TicketPriority, number>>;

  const summaryCards: StatCard[] = showToolbar
    ? [
        { label: "Abiertos", value: statusCountMap.OPEN || 0, color: "text-blue-600" },
        { label: "En Progreso", value: statusCountMap.IN_PROGRESS || 0, color: "text-amber-600" },
        {
          label: "Esperando Cliente",
          value: statusCountMap.WAITING_CUSTOMER || 0,
          color: "text-emerald-600",
        },
        { label: "Urgentes", value: priorityCountMap.URGENT || 0, color: "text-red-600" },
      ]
    : highlightStat
      ? [{ label: highlightStat.label, value: filteredCount, color: highlightStat.color }]
      : [];

  const buildHref = (p: number) => buildPageHref(basePath, searchParams, p);

  return (
    <TicketsLayout showHeader={false}>
      <div className="w-full space-y-5">
        {showToolbar ? (
          <Suspense fallback={null}>
            <TicketsPageToolbar
              totalCount={filteredCount}
              totalInSystem={totalCount}
              basePath={basePath}
              agentes={agentes}
            />
          </Suspense>
        ) : (
          <Suspense fallback={null}>
            <FilteredPageHeader
              title={title}
              subtitle={
                subtitle ??
                `${filteredCount} ${filteredCount === 1 ? "ticket" : "tickets"} encontrados`
              }
              basePath={basePath}
              searchParams={searchParams}
            />
          </Suspense>
        )}

        {showMergeButton ? (
          <div className="flex justify-end">
            <MergeDuplicateOpenTicketsButton visible={session.user?.role === "ADMIN"} />
          </div>
        ) : null}

        {summaryCards.length > 0 ? (
          <div
            className={`grid gap-3 ${summaryCards.length === 1 ? "grid-cols-1 sm:max-w-xs" : "grid-cols-2 sm:grid-cols-4"}`}
          >
            {summaryCards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <p className="text-xs font-medium text-slate-500">{card.label}</p>
                <p className={`mt-0.5 text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <TicketsTable
            compact
            tickets={tickets.map((t) => ({
              ...t,
              lastMessageAt: t.lastMessageAt.toISOString(),
              createdAt: t.createdAt.toISOString(),
            }))}
          />
          <Pagination page={safePage} totalPages={totalPages} buildHref={buildHref} />
        </div>
      </div>
    </TicketsLayout>
  );
}
