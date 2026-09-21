"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { AlertDialog } from "@/components/ui/AlertDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EditAgentModal } from "@/components/agentes/EditAgentModal";
import { ResetAgentPasswordModal } from "@/components/agentes/ResetAgentPasswordModal";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

interface Agent {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  createdAt: string;
  lastSeenAt?: string | null;
  hasPassword?: boolean;
  sessionActive?: boolean;
  _count: {
    tickets: number;
  };
}

export function AgentsList({ agentes }: { agentes: Agent[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "ADMIN" | "SUPPORT">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ONLINE" | "AVAILABLE">("ALL");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Agent | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<Agent | null>(null);
  const [alert, setAlert] = useState<{ title: string; description: string; variant: "success" | "error" | "info" } | null>(
    null,
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agentes.filter((a) => {
      if (roleFilter !== "ALL" && a.role !== roleFilter) return false;
      if (statusFilter === "ONLINE" && !a.sessionActive) return false;
      if (statusFilter === "AVAILABLE" && a.sessionActive) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
    });
  }, [agentes, query, roleFilter, statusFilter]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (menuRef.current?.contains(target)) return;
      if (target?.closest("[data-agent-menu-trigger]")) return;
      setOpenMenuId(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const openMenu = (agent: Agent, button: HTMLButtonElement) => {
    if (openMenuId === agent.id) {
      setOpenMenuId(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenMenuId(agent.id);
  };

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

  const openAgent = openMenuId ? agentes.find((a) => a.id === openMenuId) : null;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o email..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 sm:max-w-xs"
          />
          <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
            >
              <option value="ALL">Todos los roles</option>
              <option value="SUPPORT">Soporte</option>
              <option value="ADMIN">Admin</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
            >
              <option value="ALL">Todos los estados</option>
              <option value="ONLINE">Conectado</option>
              <option value="AVAILABLE">Disponible</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Agente</th>
                <th className="px-3 py-2.5">Rol</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5 text-right">Tickets asignados</th>
                <th className="px-3 py-2.5">Última actividad</th>
                <th className="w-10 px-2 py-2.5">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    {agentes.length === 0
                      ? "No hay agentes registrados aún."
                      : "Ningún agente coincide con la búsqueda."}
                  </td>
                </tr>
              ) : (
                filtered.map((agente) => (
                  <tr key={agente.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <AgentAvatar name={agente.name} size="lg" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{agente.name}</p>
                          <p className="truncate text-xs text-slate-500">{agente.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          agente.role === "ADMIN"
                            ? "bg-red-50 text-red-700 ring-1 ring-red-100"
                            : "bg-blue-50 text-blue-700 ring-1 ring-blue-100"
                        }`}
                      >
                        {agente.role === "ADMIN" ? "Admin" : "Soporte"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {agente.sessionActive ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Conectado
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                          Disponible
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-800">
                      {agente._count.tickets}
                    </td>
                    <td className="px-3 py-3 text-slate-500" title={agente.lastSeenAt ?? undefined}>
                      {agente.sessionActive
                        ? "Ahora"
                        : agente.lastSeenAt
                          ? formatRelativeTime(agente.lastSeenAt)
                          : "—"}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <button
                        type="button"
                        data-agent-menu-trigger
                        onClick={(e) => openMenu(agente, e.currentTarget)}
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        title="Acciones"
                        aria-label={`Acciones de ${agente.name}`}
                        aria-expanded={openMenuId === agente.id}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          Mostrando {filtered.length} de {agentes.length} agentes.
        </div>
      </div>

      {openAgent && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: menuPos.top, right: menuPos.right }}
              className="fixed z-[200] w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setOpenMenuId(null);
                  setEditTarget(openAgent);
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
                  setPasswordTarget(openAgent);
                }}
              >
                <KeyRound className="h-4 w-4 text-slate-400" />
                {openAgent.hasPassword ? "Restablecer contraseña" : "Asignar contraseña"}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                onClick={() => openDeleteDialog(openAgent)}
                disabled={deleting === openAgent.id}
              >
                <Trash2 className="h-4 w-4" />
                {deleting === openAgent.id ? "Eliminando…" : "Eliminar"}
              </button>
            </div>,
            document.body,
          )
        : null}

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
