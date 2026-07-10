"use client";

import { Plus, Search } from "lucide-react";

export function AgentsPageHeader() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Agentes de Soporte</h1>
        <p className="text-sm text-slate-500">Gestiona el equipo de soporte y asigna tickets</p>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Buscar agente..."
            className="rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700"
          onClick={() => document.getElementById("create-agent-form")?.scrollIntoView({ behavior: "smooth" })}
        >
          <Plus className="h-4 w-4" />
          Agregar Agente
        </button>
      </div>
    </div>
  );
}
