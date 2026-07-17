import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { isAdvisorPresentlyOnline } from "@/lib/advisorDistribution";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { CreateAgentForm } from "@/components/agentes/CreateAgentForm";
import { AgentsList } from "@/components/agentes/AgentsList";
import { AgentsPageHeader } from "@/components/agentes/AgentsPageHeader";

export default async function AgentesPage() {
  await requireAdminSession();

  const agentes = await prisma.agentUser.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      passwordHash: true,
      sessionActive: true,
      lastSeenAt: true,
      _count: {
        select: { tickets: true },
      },
    },
  });

  const totalAgentes = agentes.length;
  const agentesActivos = agentes.filter((a) => a._count.tickets > 0).length;

  return (
    <TicketsLayout showHeader={false}>
      <div className="mx-auto max-w-6xl space-y-5">
        <AgentsPageHeader />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Total Agentes" value={totalAgentes} />
          <StatCard label="Con Tickets Asignados" value={agentesActivos} accent="text-emerald-600" />
          <StatCard label="Disponibles" value={totalAgentes - agentesActivos} accent="text-violet-600" />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AgentsList
              agentes={agentes.map((a) => ({
                id: a.id,
                name: a.name,
                email: a.email,
                phone: a.phone,
                role: a.role,
                createdAt: a.createdAt.toISOString(),
                hasPassword: !!a.passwordHash,
                sessionActive: isAdvisorPresentlyOnline({
                  sessionActive: a.sessionActive,
                  lastSeenAt: a.lastSeenAt,
                }),
                _count: a._count,
              }))}
            />
          </div>
          <div>
            <CreateAgentForm />
          </div>
        </div>
      </div>
    </TicketsLayout>
  );
}

function StatCard({
  label,
  value,
  accent = "text-slate-900",
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}
