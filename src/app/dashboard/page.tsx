import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export default async function DashboardPage() {
  await requireSession();
  const [open, inProgress, waiting] = await Promise.all([
    prisma.ticket.count({ where: { status: "OPEN" } }),
    prisma.ticket.count({ where: { status: "IN_PROGRESS" } }),
    prisma.ticket.count({ where: { status: "WAITING_CUSTOMER" } }),
  ]);

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500">Visión rápida del soporte</p>
          </div>
        </header>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Abiertos" value={open} color="bg-amber-100 text-amber-800" />
          <StatCard label="En progreso" value={inProgress} color="bg-blue-100 text-blue-800" />
          <StatCard label="Esperando cliente" value={waiting} color="bg-emerald-100 text-emerald-800" />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex items-center gap-2 rounded-lg px-3 py-1 text-lg font-semibold ${color}`}>
        {value}
      </div>
    </div>
  );
}
