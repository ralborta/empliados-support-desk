"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2, Pencil, X } from "lucide-react";
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
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const dismissFeedback = () => setFeedback(null);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id, phone } = deleteTarget;
    setDeleteLoading(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (res.ok) {
        setCustomers((prev) => prev.filter((c) => c.id !== id));
        setDeleteTarget(null);
        setFeedback({ kind: "success", message: `Cliente ${phone} eliminado correctamente.` });
        router.refresh();
      } else {
        setDeleteTarget(null);
        setFeedback({
          kind: "error",
          message:
            data.error ||
            (res.status === 401
              ? "Sesión vencida. Volvé a iniciar sesión e intentá de nuevo."
              : "No se pudo eliminar el cliente."),
        });
      }
    } catch {
      setDeleteTarget(null);
      setFeedback({ kind: "error", message: "Error de red. Comprobá tu conexión e intentá de nuevo." });
    } finally {
      setDeleteLoading(false);
    }
  };

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
    setTimeout(() => handleSearch(), 100);
  };

  const handleSaved = (updated: Customer) => {
    setCustomers((prev) => prev.map((c) => (c.id === updated.id ? { ...updated } : c)));
    router.refresh();
  };

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      {feedback && (
        <div
          role="alert"
          className={`mb-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            feedback.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          <p className="pt-0.5 leading-relaxed">{feedback.message}</p>
          <button
            type="button"
            onClick={dismissFeedback}
            className="shrink-0 rounded-lg p-1 text-current opacity-70 hover:bg-black/5 hover:opacity-100"
            aria-label="Cerrar aviso"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
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
                        onClick={() => setDeleteTarget(customer)}
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

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[1px]"
          role="presentation"
          onClick={() => {
            if (!deleteLoading) setDeleteTarget(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-customer-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-customer-title" className="text-lg font-semibold text-slate-900">
              Eliminar cliente
            </h2>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              ¿Seguro que querés eliminar a{" "}
              <span className="font-semibold text-slate-900">{deleteTarget.phone}</span>
              {deleteTarget.name ? (
                <>
                  {" "}
                  (<span className="font-medium">{deleteTarget.name}</span>)
                </>
              ) : null}
              ?
            </p>
            {deleteTarget._count.tickets > 0 ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-100">
                También se borrarán <strong>{deleteTarget._count.tickets}</strong> ticket
                {deleteTarget._count.tickets === 1 ? "" : "s"} con mensajes, eventos e historial asociados.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Este cliente no tiene tickets registrados.</p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => void confirmDelete()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteLoading ? "Eliminando…" : "Eliminar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
