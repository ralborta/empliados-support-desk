"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useCallback, useState } from "react";
import { statusLabels, priorityLabels } from "@/lib/tickets";

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "OPEN", label: statusLabels.OPEN },
  { value: "IN_PROGRESS", label: statusLabels.IN_PROGRESS },
  { value: "WAITING_CUSTOMER", label: statusLabels.WAITING_CUSTOMER },
  { value: "RESOLVED", label: statusLabels.RESOLVED },
  { value: "CLOSED", label: statusLabels.CLOSED },
];

const PRIORITY_OPTIONS = [
  { value: "all", label: "Todas las prioridades" },
  { value: "URGENT", label: priorityLabels.URGENT },
  { value: "HIGH", label: priorityLabels.HIGH },
  { value: "NORMAL", label: priorityLabels.NORMAL },
  { value: "LOW", label: priorityLabels.LOW },
];

export function TicketsPageToolbar({
  totalCount,
  totalInSystem,
  basePath,
  agentes,
  hideFixedFilters = false,
}: {
  totalCount: number;
  totalInSystem: number;
  basePath: string;
  agentes: Array<{ id: string; name: string }>;
  hideFixedFilters?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");

  const currentStatus = searchParams.get("status") || "all";
  const currentPriority = searchParams.get("priority") || "all";
  const currentAssigned = searchParams.get("assigned") || "all";

  const pushParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === "all") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.push(qs ? `${basePath}?${qs}` : basePath);
    },
    [basePath, router, searchParams]
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    pushParams({ q: query.trim() || null });
  }

  const hasActiveFilters =
    !!searchParams.get("q") ||
    currentStatus !== "all" ||
    currentPriority !== "all" ||
    currentAssigned !== "all";

  function clearFilters() {
    setQuery("");
    router.push(basePath);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Todos los Tickets</h2>
          <p className="text-sm text-slate-500">
            {totalCount === totalInSystem
              ? `${totalCount} ${totalCount === 1 ? "ticket" : "tickets"} en el sistema`
              : `${totalCount} de ${totalInSystem} tickets (filtrados)`}
          </p>
        </div>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <X className="h-4 w-4" />
            Limpiar filtros
          </button>
        ) : null}
      </div>

      {!hideFixedFilters ? (
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={currentStatus}
            onChange={(e) => pushParams({ status: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === "all" ? "Estado" : o.label}
              </option>
            ))}
          </select>

          <select
            value={currentPriority}
            onChange={(e) => pushParams({ priority: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === "all" ? "Prioridad" : o.label}
              </option>
            ))}
          </select>

          <select
            value={currentAssigned}
            onChange={(e) => pushParams({ assigned: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
          >
            <option value="all">Asignado</option>
            <option value="none">Sin asignar</option>
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <form onSubmit={handleSearch} className="relative ml-auto flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Buscar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}
