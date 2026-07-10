import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsUrgentesPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/urgentes"
      title="Tickets Urgentes"
      subtitle="Requieren atención inmediata"
      searchParams={await searchParams}
      fixedFilter={{ priority: "URGENT" }}
      highlightStat={{ label: "Urgentes", color: "text-red-600" }}
    />
  );
}
