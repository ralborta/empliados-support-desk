import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsAltaPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/alta"
      title="Prioridad Alta"
      searchParams={await searchParams}
      fixedFilter={{ priority: "HIGH" }}
      highlightStat={{ label: "Alta prioridad", color: "text-orange-600" }}
    />
  );
}
