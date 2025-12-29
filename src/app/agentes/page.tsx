import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { CreateAgentForm } from "@/components/agentes/CreateAgentForm";
import { AgentsList } from "@/components/agentes/AgentsList";

export default async function AgentesPage() {
  await requireSession();

  const agentes = await prisma.agentUser.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { tickets: true },
      },
    },
  });

  const totalAgentes = agentes.length;
  const agentesActivos = agentes.filter((a) => a._count.tickets > 0).length;

  return (
    <TicketsLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Agentes de Soporte</h1>
          <p className="mt-1 text-sm text-slate-500">
            Gestiona el equipo de soporte y asigna tickets
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-blue-50 p-6 ring-1 ring-blue-100">
            <div className="text-sm font-medium text-blue-600">Total Agentes</div>
            <div className="mt-2 text-3xl font-bold text-blue-900">{totalAgentes}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 p-6 ring-1 ring-emerald-100">
            <div className="text-sm font-medium text-emerald-600">Con Tickets Asignados</div>
            <div className="mt-2 text-3xl font-bold text-emerald-900">{agentesActivos}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-6 ring-1 ring-slate-100">
            <div className="text-sm font-medium text-slate-600">Disponibles</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{totalAgentes - agentesActivos}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AgentsList agentes={agentes} />
          </div>
          <div>
            <CreateAgentForm />
          </div>
        </div>
      </div>
    </TicketsLayout>
  );
}
