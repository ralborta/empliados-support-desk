import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsEnProgresoPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/en-progreso"
      title="Tickets En Progreso"
      subtitle="Casos siendo atendidos actualmente"
      searchParams={await searchParams}
      fixedFilter={{ status: "IN_PROGRESS" }}
      highlightStat={{ label: "En Progreso", color: "text-amber-600" }}
    />
  );
}
