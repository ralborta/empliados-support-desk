"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KeyRound, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { AlertDialog } from "@/components/ui/AlertDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EditAgentModal } from "@/components/agentes/EditAgentModal";
import { ResetAgentPasswordModal } from "@/components/agentes/ResetAgentPasswordModal";

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
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<Agent | null>(null);
  const [alert, setAlert] = useState<{ title: string; description: string; variant: "success" | "error" | "info" } | null>(
    null,
  );
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

  const openDeleteDialog = (agent: Agent) => {
    setOpenMenuId(null);
    setDeleteError(null);
    setDeleteTarget(agent);
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(deleteTarget.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/agentes/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "Error al eliminar");
        return;
      }
      setDeleteTarget(null);
      router.refresh();
    } catch {
      setDeleteError("Error de red");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
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
                        onClick={() => {
                          setOpenMenuId(null);
                          setEditTarget(agente);
                        }}
                      >
                        <Pencil className="h-4 w-4 text-slate-400" />
                        Editar datos
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          setOpenMenuId(null);
                          setPasswordTarget(agente);
                        }}
                      >
                        <KeyRound className="h-4 w-4 text-slate-400" />
                        {agente.hasPassword ? "Restablecer contraseña" : "Asignar contraseña"}
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                        onClick={() => openDeleteDialog(agente)}
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar agente"
        description={
          deleteTarget ? (
            <>
              ¿Seguro que querés eliminar a{" "}
              <span className="font-semibold text-slate-900">{deleteTarget.name}</span>?
              {deleteTarget._count.tickets > 0 ? (
                <span className="mt-2 block text-slate-500">
                  Tiene {deleteTarget._count.tickets}{" "}
                  {deleteTarget._count.tickets === 1 ? "ticket asignado" : "tickets asignados"} que quedarán sin
                  asignar.
                </span>
              ) : null}
            </>
          ) : null
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="danger"
        loading={!!deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={closeDeleteDialog}
      />

      <EditAgentModal
        agent={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => router.refresh()}
      />

      <ResetAgentPasswordModal
        agent={passwordTarget}
        onClose={() => setPasswordTarget(null)}
        onSaved={(name) =>
          setAlert({
            title: "Contraseña actualizada",
            description: `La contraseña de ${name} quedó guardada. Compartila con el asesor por un canal seguro.`,
            variant: "success",
          })
        }
      />

      <AlertDialog
        open={!!alert}
        title={alert?.title ?? ""}
        description={alert?.description ?? ""}
        variant={alert?.variant ?? "info"}
        onClose={() => setAlert(null)}
      />
    </>
  );
}
