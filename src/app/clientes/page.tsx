import { requireSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { CreateCustomerForm } from "@/components/clientes/CreateCustomerForm";
import { ImportExcelForm } from "@/components/clientes/ImportExcelForm";
import { CustomersList } from "@/components/clientes/CustomersList";
import { prisma } from "@/lib/db";

export default async function ClientesPage() {
  await requireSession();

  const customers = await prisma.customer.findMany({
    include: {
      _count: {
        select: { tickets: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const totalCustomers = await prisma.customer.count();

  return (
    <TicketsLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">👤 Clientes</h1>
          <p className="mt-1 text-sm text-slate-500">
            Alta manual, <strong className="text-slate-700">edición / eliminación</strong> en la tabla y{" "}
            <strong className="text-slate-700">carga masiva por Excel</strong> (arriba). Solo los números dados de
            alta reciben casos por WhatsApp.
          </p>
        </div>

        <section
          className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-b from-indigo-50/80 to-white p-5 shadow-sm ring-1 ring-indigo-100"
          aria-labelledby="import-excel-heading"
        >
          <h2 id="import-excel-heading" className="sr-only">
            Importar clientes desde Excel
          </h2>
          <ImportExcelForm />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <CreateCustomerForm />
          </div>

          <div className="lg:col-span-2">
            <CustomersList initialCustomers={customers as any} initialTotal={totalCustomers} />
          </div>
        </div>
      </div>
    </TicketsLayout>
  );
}
