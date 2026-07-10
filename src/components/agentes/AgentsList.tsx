"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";

interface Agent {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  createdAt: Date;
  _count: {
    tickets: number;
  };
}

export function AgentsList({ agentes }: { agentes: Agent[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Seguro que querés eliminar a ${name}?`)) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/agentes/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Error al eliminar");
        return;
      }
      router.refresh();
    } catch {
      alert("Error de red");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-semibold text-slate-900">Equipo de Soporte</h2>
      </div>
      <div className="divide-y divide-slate-50">
        {agentes.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No hay agentes registrados aún.
          </div>
        ) : (
          agentes.map((agente) => (
            <div
              key={agente.id}
              className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50/80"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <AgentAvatar name={agente.name} size="lg" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{agente.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        agente.role === "ADMIN"
                          ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                          : "bg-blue-50 text-blue-700 ring-1 ring-blue-100"
                      }`}
                    >
                      {agente.role === "ADMIN" ? "Admin" : "Soporte"}
                    </span>
                  </div>
                  <p className="truncate text-sm text-slate-500">{agente.email}</p>
                  <p className="text-xs text-slate-400">
                    {agente._count.tickets}{" "}
                    {agente._count.tickets === 1 ? "ticket asignado" : "tickets asignados"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDelete(agente.id, agente.name)}
                  disabled={deleting === agente.id}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  title="Eliminar agente"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
