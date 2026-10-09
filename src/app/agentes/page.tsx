import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { ADVISOR_ACTIVE_TICKET_STATUSES, isAdvisorPresentlyOnline } from "@/lib/advisorDistribution";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { CreateAgentForm } from "@/components/agentes/CreateAgentForm";
import { AgentsList } from "@/components/agentes/AgentsList";
import { AgentsPageHeader } from "@/components/agentes/AgentsPageHeader";
import type { ReactNode } from "react";
import { Ticket, UserCheck, Users } from "lucide-react";

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
        select: {
          tickets: { where: { status: { in: ADVISOR_ACTIVE_TICKET_STATUSES } } },
        },
      },
    },
  });

  const totalAgentes = agentes.length;
  const conTickets = agentes.filter((a) => a._count.tickets > 0).length;
  const disponibles = totalAgentes - conTickets;

  return (
    <TicketsLayout showHeader={false}>
      <div className="mx-auto max-w-6xl space-y-5">
        <AgentsPageHeader />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="agentes"
            value={totalAgentes}
            icon={<Users className="h-4 w-4" />}
            iconClass="bg-violet-100 text-violet-700"
          />
          <StatCard
            label="disponibles"
            value={disponibles}
            icon={<UserCheck className="h-4 w-4" />}
            iconClass="bg-emerald-100 text-emerald-700"
          />
          <StatCard
            label="con tickets asignados"
            value={conTickets}
            icon={<Ticket className="h-4 w-4" />}
            iconClass="bg-blue-100 text-blue-700"
          />
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
                lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
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
  icon,
  iconClass,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  iconClass: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${iconClass}`}>{icon}</span>
      <p className="text-sm text-slate-700">
        <span className="font-bold text-slate-900">{value}</span> {label}
      </p>
    </div>
  );
}
