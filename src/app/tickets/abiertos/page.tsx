import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsAbiertosPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/abiertos"
      title="Tickets Abiertos"
      subtitle="Tickets pendientes de atención"
      searchParams={await searchParams}
      fixedFilter={{ status: "OPEN" }}
      highlightStat={{ label: "Total Abiertos", color: "text-blue-600" }}
    />
  );
}
