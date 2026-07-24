"use client";

import Link from "next/link";
import { Bell, X } from "lucide-react";
import { priorityLabels } from "@/lib/tickets";
import { priorityBadgeClass } from "@/lib/ui/badges";

export type AssignmentToastItem = {
  id: string;
  type: string;
  ticket: {
    id: string;
    code: string;
    title: string;
    priority: string;
    customer: { companyName: string | null; name: string | null };
  };
};

type Props = {
  items: AssignmentToastItem[];
  onDismiss: (id: string) => void;
};

function toastHeading(n: AssignmentToastItem): string {
  if (n.type === "UNASSIGNED_ALERT") return "Caso sin asesor conectado";
  if (n.type === "REASSIGNED") return "Caso reasignado";
  return "Nuevo caso asignado";
}

export function AgentAssignmentToastStack({ items, onDismiss }: Props) {
  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(100vw-2rem,22rem)] flex-col gap-3"
      aria-live="polite"
    >
      {items.map((n) => {
        const company = n.ticket.customer.companyName || n.ticket.customer.name || "Cliente";
        const priority = n.ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT";
        return (
          <div
            key={n.id}
            className="pointer-events-auto overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5 transition duration-300"
          >
            <div className="flex gap-0">
              <div className="w-1 shrink-0 bg-violet-600" aria-hidden />
              <div className="min-w-0 flex-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
                      <Bell className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                        {toastHeading(n)}
                      </p>
                      <p className="text-[11px] text-slate-500">Mesa de Ayuda Wara</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDismiss(n.id)}
                    className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Cerrar notificación"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">{n.ticket.code}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${priorityBadgeClass(priority)}`}
                  >
                    {priorityLabels[priority] ?? n.ticket.priority}
                  </span>
                </div>

                <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-800">{n.ticket.title}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{company}</p>

                {n.type === "UNASSIGNED_ALERT" ? (
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                    Sin asesor conectado — requiere atención
                  </p>
                ) : null}

                <Link
                  href={`/tickets/${n.ticket.id}`}
                  onClick={() => onDismiss(n.id)}
                  className="mt-3 inline-flex text-xs font-semibold text-violet-600 hover:text-violet-800"
                >
                  Abrir ticket →
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
