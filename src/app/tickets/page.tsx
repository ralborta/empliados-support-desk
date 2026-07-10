import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  const params = await searchParams;

  return (
    <TicketsListPage
      basePath="/tickets"
      title="Todos los Tickets"
      searchParams={params}
      showToolbar
      showMergeButton
    />
  );
}
