"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2, Pencil } from "lucide-react";
import { EditCustomerModal, type CustomerRow } from "@/components/clientes/EditCustomerModal";

interface Customer extends CustomerRow {}

interface CustomersListProps {
  initialCustomers: Customer[];
  initialTotal: number;
}

export function CustomersList({ initialCustomers, initialTotal }: CustomersListProps) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasTicketsFilter, setHasTicketsFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.append("q", searchQuery);
      }
      if (hasTicketsFilter !== "all") {
        params.append("hasTickets", hasTicketsFilter);
      }

      const res = await fetch(`/api/clientes?${params.toString()}`);
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch {
      // Error en búsqueda
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (value: string) => {
    setHasTicketsFilter(value);
    // Aplicar filtro automáticamente
    setTimeout(() => handleSearch(), 100);
  };

  const handleDelete = async (id: string, phone: string) => {
    if (!confirm(`¿Estás seguro de eliminar el cliente ${phone}?`)) return;

    try {
      const res = await fetch(`/api/clientes/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setCustomers((prev) => prev.filter((c) => c.id !== id));
        router.refresh();
      } else {
        alert("Error al eliminar cliente");
      }
    } catch {
      alert("Error de red");
    }
  };

  const handleSaved = (updated: Customer) => {
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? { ...updated } : c)));
    router.refresh();
  };

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Clientes</h2>
          <p className="text-sm text-slate-500 mt-1">
            {initialTotal} {initialTotal === 1 ? "cliente" : "clientes"} en total
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Buscar por teléfono, persona, empresa o patente..."
                className="w-full sm:w-auto pl-10 pr-4 py-2 rounded-lg border border-slate-300 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
            <select
              value={hasTicketsFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white min-w-[160px]"
            >
              <option value="all">Todos los clientes</option>
              <option value="true">Con tickets</option>
              <option value="false">Sin tickets</option>
            </select>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 whitespace-nowrap"
            >
              {loading ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Teléfono</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Persona</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Empresa</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Patente</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Tickets</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Fecha</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  No se encontraron clientes
                </td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 text-sm text-slate-900 font-medium">{customer.phone}</td>
                  <td className="py-3 px-4 text-sm text-slate-700">{customer.name || "—"}</td>
                  <td className="py-3 px-4 text-sm text-slate-700">{customer.companyName || "—"}</td>
                  <td className="py-3 px-4 text-sm text-slate-700 font-mono">{customer.licensePlate || "—"}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    <span className="inline-flex items-center px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">
                      {customer._count.tickets}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-500">
                    {new Date(customer.createdAt).toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(customer)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        title="Editar cliente"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Editar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(customer.id, customer.phone)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50/80 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                        title="Eliminar cliente"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Eliminar</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <EditCustomerModal customer={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
    </div>
  );
}
