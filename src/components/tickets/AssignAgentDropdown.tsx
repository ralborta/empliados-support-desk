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

  const handleChange = async (newAgentId: string) => {
    setSelectedAgentId(newAgentId);
    setLoading(true);

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
        alert("Error al asignar agente");
        setSelectedAgentId(currentAgentId || "");
      }
    } catch (error) {
      alert("Error de red");
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
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">Sin asignar</option>
        {agentes.map((agente) => (
          <option key={agente.id} value={agente.id}>
            {agente.name} ({agente.email})
          </option>
        ))}
      </select>
      {loading && (
        <div className="mt-2 text-xs text-indigo-600">
          Actualizando...
        </div>
      )}
    </div>
  );
}
