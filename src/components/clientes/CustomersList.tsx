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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {feedback && (
        <div
          role="alert"
          className={`mx-5 mt-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
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
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Listado</h2>
            <p className="text-sm text-slate-500">
              {initialTotal} {initialTotal === 1 ? "cliente" : "clientes"} en total
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Buscar..."
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 sm:w-56"
              />
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
            <select
              value={hasTicketsFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-violet-400 focus:outline-none"
            >
              <option value="all">Todos</option>
              <option value="true">Con tickets</option>
              <option value="false">Sin tickets</option>
            </select>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {loading ? "..." : "Buscar"}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto p-2">
        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/80">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teléfono</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Persona</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Empresa</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Patente</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tickets</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha</th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {customers.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  No se encontraron clientes
                </td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-violet-50/30">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">{customer.phone}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{customer.name || "—"}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{customer.companyName || "—"}</td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-700">{customer.licensePlate || "—"}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-100">
                      {customer._count.tickets}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(customer.createdAt).toLocaleDateString("es-AR")}
                  </td>
                  <td className="px-4 py-3 text-right">
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
