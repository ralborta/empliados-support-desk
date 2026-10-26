"use client";

import { ExternalLink, Plus } from "lucide-react";

export function AgentsPageHeader() {
  const goToForm = () => {
    document.getElementById("create-agent-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.getElementById("agent-name")?.focus(), 350);
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Agentes de Soporte</h1>
        <p className="text-sm text-slate-500">Gestiona el equipo, credenciales y acceso al panel.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-900"
          onClick={goToForm}
        >
          Formulario de alta
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700"
          onClick={goToForm}
        >
          <Plus className="h-4 w-4" />
          Nuevo agente
        </button>
      </div>
    </div>
  );
}
