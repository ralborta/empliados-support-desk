import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsBajaPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/baja"
      title="Prioridad Baja"
      searchParams={await searchParams}
      fixedFilter={{ priority: "LOW" }}
      highlightStat={{ label: "Prioridad baja", color: "text-slate-600" }}
    />
  );
}
