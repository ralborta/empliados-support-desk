"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KeyRound, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";

interface Agent {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  createdAt: string;
  hasPassword?: boolean;
  sessionActive?: boolean;
  _count: {
    tickets: number;
  };
}

export function AgentsList({ agentes }: { agentes: Agent[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleDelete = async (id: string, name: string) => {
    setOpenMenuId(null);
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

  const handleResetPassword = async (agent: Agent) => {
    setOpenMenuId(null);
    const pwd = prompt(
      `Nueva contraseña para ${agent.name} (mínimo 8 caracteres):\n\nCompartila de forma segura con el asesor.`,
    );
    if (!pwd) return;
    if (pwd.length < 8) {
      alert("La contraseña debe tener al menos 8 caracteres");
      return;
    }

    try {
      const res = await fetch(`/api/agentes/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No se pudo restablecer la contraseña");
        return;
      }
      alert(`Contraseña actualizada para ${agent.name}.`);
      router.refresh();
    } catch {
      alert("Error de red");
    }
  };

  const handleEdit = async (agent: Agent) => {
    setOpenMenuId(null);
    const name = prompt("Nombre completo:", agent.name);
    if (name === null) return;
    const email = prompt("Email:", agent.email);
    if (email === null) return;
    const roleInput = prompt('Rol: escribí "ADMIN" o "SUPPORT"', agent.role);
    if (roleInput === null) return;
    const role = roleInput.toUpperCase() === "ADMIN" ? "ADMIN" : "SUPPORT";

    try {
      const res = await fetch(`/api/agentes/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No se pudo actualizar");
        return;
      }
      router.refresh();
    } catch {
      alert("Error de red");
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
                    {agente.sessionActive ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                        Conectado
                      </span>
                    ) : null}
                    {agente.hasPassword === false ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-100">
                        Sin contraseña
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-sm text-slate-500">{agente.email}</p>
                  <p className="text-xs text-slate-400">
                    {agente._count.tickets}{" "}
                    {agente._count.tickets === 1 ? "ticket asignado" : "tickets asignados"}
                  </p>
                </div>
              </div>
              <div className="relative flex items-center gap-1" ref={openMenuId === agente.id ? menuRef : undefined}>
                <button
                  type="button"
                  onClick={() => setOpenMenuId(openMenuId === agente.id ? null : agente.id)}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  title="Acciones"
                  aria-label="Acciones del agente"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>

                {openMenuId === agente.id ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => handleEdit(agente)}
                    >
                      <Pencil className="h-4 w-4 text-slate-400" />
                      Editar datos
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => handleResetPassword(agente)}
                    >
                      <KeyRound className="h-4 w-4 text-slate-400" />
                      {agente.hasPassword ? "Restablecer contraseña" : "Asignar contraseña"}
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                      onClick={() => handleDelete(agente.id, agente.name)}
                      disabled={deleting === agente.id}
                    >
                      <Trash2 className="h-4 w-4" />
                      {deleting === agente.id ? "Eliminando…" : "Eliminar"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
