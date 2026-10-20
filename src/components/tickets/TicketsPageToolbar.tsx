"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, HelpCircle, UserX } from "lucide-react";
import { useCallback, useState } from "react";
import { statusLabels, priorityLabels } from "@/lib/tickets";
import { waraAccent } from "@/lib/ui/waraTheme";
import { MergeDuplicateOpenTicketsButton } from "@/components/tickets/MergeDuplicateOpenTicketsButton";

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

const selectClass =
  "rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 shadow-sm focus:border-[#4a0e1c]/40 focus:outline-none focus:ring-2 focus:ring-[#4a0e1c]/15";

export function TicketsPageToolbar({
  totalCount,
  totalInSystem,
  basePath,
  agentes,
  hideFixedFilters = false,
  isAdmin = true,
  showMergeButton = false,
}: {
  totalCount: number;
  totalInSystem: number;
  basePath: string;
  agentes: Array<{ id: string; name: string }>;
  hideFixedFilters?: boolean;
  isAdmin?: boolean;
  showMergeButton?: boolean;
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
    [basePath, router, searchParams],
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

  const countLabel =
    totalCount === totalInSystem
      ? `${totalCount} en el sistema`
      : `${totalCount} de ${totalInSystem}`;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            {isAdmin ? "Todos los Tickets" : "Mis casos asignados"}
          </h2>
          <p className="text-xs text-slate-500">{countLabel}</p>
        </div>
        <form onSubmit={handleSearch} className="relative w-full sm:max-w-xs sm:shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Buscar tickets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm shadow-sm ${waraAccent.ring}`}
            aria-label="Buscar tickets"
          />
        </form>
      </div>

      {!hideFixedFilters ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 shadow-sm">
          <select
            value={currentStatus}
            onChange={(e) => pushParams({ status: e.target.value })}
            className={selectClass}
            aria-label="Filtrar por estado"
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
            className={selectClass}
            aria-label="Filtrar por prioridad"
          >
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === "all" ? "Prioridad" : o.label}
              </option>
            ))}
          </select>

          {isAdmin ? (
            <select
              value={currentAssigned}
              onChange={(e) => pushParams({ assigned: e.target.value })}
              className={selectClass}
              aria-label="Filtrar por asignación"
            >
              <option value="all">Asignado</option>
              <option value="none">Sin asignar</option>
              {agentes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : null}

          {isAdmin ? (
            <button
              type="button"
              onClick={() => pushParams({ assigned: currentAssigned === "none" ? "all" : "none" })}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${waraAccent.ring} ${
                currentAssigned === "none"
                  ? "bg-[#4a0e1c] text-white"
                  : "bg-slate-100 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
              aria-pressed={currentAssigned === "none"}
            >
              <UserX className="h-3 w-3" aria-hidden />
              Sin asignar
            </button>
          ) : null}

          {showMergeButton && isAdmin ? (
            <MergeDuplicateOpenTicketsButton visible compact className="ml-auto" />
          ) : null}

          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 ${showMergeButton && isAdmin ? "" : "ml-auto"}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Limpiar
            </button>
          ) : null}

          {showMergeButton && isAdmin ? (
            <span
              className="hidden items-center text-slate-400 sm:inline-flex"
              title="Une conversaciones abiertas duplicadas del mismo cliente en un solo ticket (el más reciente)."
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Ayuda fusionar duplicados</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
