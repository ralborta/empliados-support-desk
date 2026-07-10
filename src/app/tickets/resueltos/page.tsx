import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsResueltosPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/resueltos"
      title="Tickets Resueltos"
      subtitle="Casos resueltos recientemente"
      searchParams={await searchParams}
      fixedFilter={{ status: "RESOLVED" }}
      highlightStat={{ label: "Resueltos", color: "text-teal-600" }}
    />
  );
}
