"use client";

import { ChevronDown } from "lucide-react";

export function AgentsPageHeader() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Agentes de Soporte</h1>
        <p className="text-sm text-slate-500">Gestiona el equipo, credenciales y acceso al panel</p>
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 shadow-sm hover:bg-violet-100"
        onClick={() =>
          document.getElementById("create-agent-form")?.scrollIntoView({ behavior: "smooth" })
        }
      >
        Ir al formulario de alta
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
}
