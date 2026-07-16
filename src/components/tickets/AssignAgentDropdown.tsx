"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Agent {
  id: string;
  name: string;
  email: string;
}

interface AssignAgentDropdownProps {
  ticketId: string;
  currentAgentId: string | null;
  agentes: Agent[];
}

export function AssignAgentDropdown({ ticketId, currentAgentId, agentes }: AssignAgentDropdownProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(currentAgentId || "");
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (newAgentId: string) => {
    setSelectedAgentId(newAgentId);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedToUserId: newAgentId || null,
        }),
      });

      if (res.ok) {
        router.refresh();
      } else {
        setError("Error al asignar agente");
        setSelectedAgentId(currentAgentId || "");
      }
    } catch {
      setError("Error de red");
      setSelectedAgentId(currentAgentId || "");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-2">
        👤 Asignado a:
      </label>
      <select
        value={selectedAgentId}
        onChange={(e) => handleChange(e.target.value)}
        disabled={loading}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-rose-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">Sin asignar</option>
        {agentes.map((agente) => (
          <option key={agente.id} value={agente.id}>
            {agente.name} ({agente.email})
          </option>
        ))}
      </select>
      {loading && (
        <div className="mt-2 text-xs text-rose-700">
          Actualizando...
        </div>
      )}
      {error ? (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
