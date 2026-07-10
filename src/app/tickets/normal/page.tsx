import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsNormalPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/normal"
      title="Prioridad Normal"
      searchParams={await searchParams}
      fixedFilter={{ priority: "NORMAL" }}
      highlightStat={{ label: "Prioridad normal", color: "text-emerald-600" }}
    />
  );
}
