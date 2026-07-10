import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsCerradosPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/cerrados"
      title="Tickets Cerrados"
      subtitle="Historial de casos cerrados"
      searchParams={await searchParams}
      fixedFilter={{ status: "CLOSED" }}
      highlightStat={{ label: "Cerrados", color: "text-slate-600" }}
    />
  );
}
