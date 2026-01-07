"use client";

import { useState } from "react";
import { Search, Trash2, Edit2 } from "lucide-react";

interface Customer {
  id: string;
  phone: string;
  name: string | null;
  createdAt: string;
  _count: {
    tickets: number;
  };
}

interface CustomersListProps {
  initialCustomers: Customer[];
  initialTotal: number;
}

export function CustomersList({ initialCustomers, initialTotal }: CustomersListProps) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [searchQuery, setSearchQuery] = useState("");
  const [hasTicketsFilter, setHasTicketsFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);

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
      } else {
        alert("Error al eliminar cliente");
      }
    } catch {
      alert("Error de red");
    }
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
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Buscar por teléfono o nombre..."
              className="pl-10 pr-4 py-2 rounded-lg border border-slate-300 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
          <select
            value={hasTicketsFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white"
          >
            <option value="all">Todos los clientes</option>
            <option value="true">Con tickets</option>
            <option value="false">Sin tickets</option>
          </select>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Teléfono</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Nombre / Empresa</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Tickets</th>
              <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Fecha</th>
              <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  No se encontraron clientes
                </td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-4 text-sm text-slate-900 font-medium">{customer.phone}</td>
                  <td className="py-3 px-4 text-sm text-slate-700">{customer.name || "Sin nombre"}</td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    <span className="inline-flex items-center px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">
                      {customer._count.tickets}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-500">
                    {new Date(customer.createdAt).toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleDelete(customer.id, customer.phone)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
