import { TicketsListPage } from "@/components/tickets/TicketsListPage";
import type { TicketListSearchParams } from "@/lib/ticketListQuery";

export default async function TicketsEsperandoClientePage({
  searchParams,
}: {
  searchParams: Promise<TicketListSearchParams>;
}) {
  return (
    <TicketsListPage
      basePath="/tickets/esperando-cliente"
      title="Esperando Cliente"
      subtitle="Aguardando respuesta del cliente"
      searchParams={await searchParams}
      fixedFilter={{ status: "WAITING_CUSTOMER" }}
      highlightStat={{ label: "Esperando Cliente", color: "text-emerald-600" }}
    />
  );
}
