"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NotificationBell } from "@/components/layout/NotificationBell";

export function PageHeader({
  userName,
  urgentCount = 0,
  subtitle,
}: {
  userName?: string;
  urgentCount?: number;
  subtitle?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const firstName = userName?.split(/\s+/)[0] || "equipo";

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/tickets?q=${encodeURIComponent(q)}`);
    else router.push("/tickets");
  }

  return (
    <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          ¡Hola, {firstName}! <span aria-hidden>👋</span>
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {subtitle || "Acá tenés un resumen de la actividad de hoy en la mesa de ayuda."}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <form onSubmit={handleSearch} className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Buscar tickets, clientes, agentes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-72 rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 lg:w-80"
          />
        </form>
        <NotificationBell />
      </div>
    </header>
  );
}
