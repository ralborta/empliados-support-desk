import { requireAdminSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { AtilioConfigScreen } from "@/components/configuracion/AtilioConfigScreen";

export default async function ConfiguracionPage() {
  await requireAdminSession();

  return (
    <TicketsLayout showHeader={false}>
      <AtilioConfigScreen />
    </TicketsLayout>
  );
}
