import { requireSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { CreateCustomerForm } from "@/components/clientes/CreateCustomerForm";
import { ImportExcelForm } from "@/components/clientes/ImportExcelForm";
import { CustomersList } from "@/components/clientes/CustomersList";
import { prisma } from "@/lib/db";
import { UserCircle, Upload } from "lucide-react";

export default async function ClientesPage() {
  await requireSession();

  const [customers, totalCustomers, withTickets] = await Promise.all([
    prisma.customer.findMany({
      include: { _count: { select: { tickets: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.customer.count(),
    prisma.customer.count({ where: { tickets: { some: {} } } }),
  ]);

  return (
    <TicketsLayout showHeader={false}>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Clientes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Alta manual, edición y carga masiva por Excel. Solo los números registrados reciben
            casos por WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Total clientes" value={totalCustomers} color="text-violet-600" />
          <StatCard label="Con tickets" value={withTickets} color="text-emerald-600" />
          <StatCard
            label="Sin tickets"
            value={totalCustomers - withTickets}
            color="text-slate-600"
          />
        </div>

        <section
          className="rounded-xl border border-violet-100 bg-gradient-to-b from-violet-50/60 to-white p-5 shadow-sm"
          aria-labelledby="import-excel-heading"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-violet-800">
            <Upload className="h-4 w-4" />
            Importar desde Excel
          </div>
          <ImportExcelForm />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <CreateCustomerForm />
          </div>
          <div className="lg:col-span-2">
            <CustomersList
              initialCustomers={customers.map((c) => ({
                ...c,
                createdAt: c.createdAt.toISOString(),
              }))}
              initialTotal={totalCustomers}
            />
          </div>
        </div>
      </div>
    </TicketsLayout>
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
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <UserCircle className="h-4 w-4 text-slate-400" />
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
