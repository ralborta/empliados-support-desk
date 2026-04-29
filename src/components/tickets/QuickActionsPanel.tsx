"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolutionModeLabels, type ResolutionMode } from "@/lib/wara";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

const resolutionModes: ResolutionMode[] = [
  "CHAT_RESOLVED",
  "PENDING_VALIDATION",
  "BACKOFFICE_DERIVED",
  "TECH_ESCALATED",
  "CLOSED_NO_ACTION",
];

const quickBtnBase =
  "group relative flex min-h-[2.75rem] items-center justify-center overflow-hidden rounded-xl border px-3 py-2 text-center text-xs font-semibold leading-tight shadow-sm outline-none select-none touch-manipulation " +
  "transition-all duration-200 ease-out " +
  "hover:-translate-y-0.5 hover:shadow-md " +
  "active:translate-y-0 active:scale-[0.96] active:shadow-inner active:duration-100 " +
  "focus-visible:ring-2 focus-visible:ring-rose-400/80 focus-visible:ring-offset-2 " +
  "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0";

type QuickAction =
  | "request_data"
  | "in_analysis"
  | "derive"
  | "resolve"
  | "close"
  | "internal_note";

const quickActionStyles: Record<QuickAction, string> = {
  request_data:
    "border-amber-200/90 bg-gradient-to-br from-amber-50 to-amber-100/80 text-amber-950 hover:border-amber-300 hover:from-amber-100 hover:to-amber-50 active:from-amber-100",
  in_analysis:
    "border-sky-200/90 bg-gradient-to-br from-sky-50 to-sky-100/80 text-sky-950 hover:border-sky-300 hover:from-sky-100 hover:to-sky-50 active:from-sky-100",
  derive:
    "border-violet-200/90 bg-gradient-to-br from-violet-50 to-violet-100/80 text-violet-950 hover:border-violet-300 hover:from-violet-100 hover:to-violet-50 active:from-violet-100",
  resolve:
    "border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-emerald-100/80 text-emerald-950 hover:border-emerald-300 hover:from-emerald-100 hover:to-emerald-50 active:from-emerald-100",
  close:
    "border-slate-200/90 bg-gradient-to-br from-slate-50 to-slate-100/90 text-slate-800 hover:border-slate-300 hover:from-slate-100 hover:to-white active:from-slate-100",
  internal_note:
    "border-rose-200/80 bg-gradient-to-br from-rose-50/90 to-rose-100/70 text-rose-950 hover:border-rose-300 hover:from-rose-100 hover:to-rose-50 active:from-rose-100",
};

const quickActionItems: { action: QuickAction; label: string }[] = [
  { action: "request_data", label: "Solicitar más datos" },
  { action: "in_analysis", label: "Marcar en análisis" },
  { action: "derive", label: "Derivar" },
  { action: "resolve", label: "Resolver" },
  { action: "close", label: "Cerrar" },
  { action: "internal_note", label: "Nota interna" },
];

export function QuickActionsPanel({
  ticketId,
  currentPriority,
  currentResolution,
}: {
  ticketId: string;
  currentPriority: TicketPriority;
  currentResolution?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [resolution, setResolution] = useState(currentResolution || "");

  const patchTicket = (payload: { status?: TicketStatus; priority?: TicketPriority; resolution?: string }) => {
    startTransition(async () => {
      await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      router.refresh();
    });
  };

  const runQuickAction = (action: QuickAction) => {
    startTransition(async () => {
      const res = await fetch(`/api/tickets/${ticketId}/quick-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Acción rápida:", err);
        alert(err?.error || "No se pudo completar la acción");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(225,29,72,0.45)]" aria-hidden />
        <div className="text-sm font-semibold tracking-tight text-slate-800">Acciones rápidas</div>
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        Cada acción envía un mensaje por WhatsApp (salvo nota interna) y actualiza el estado del ticket.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {quickActionItems.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            className={`${quickBtnBase} ${quickActionStyles[action]}`}
            disabled={isPending}
            onClick={() => runQuickAction(action)}
          >
            <span
              className="pointer-events-none absolute inset-0 bg-white/30 opacity-0 transition-opacity duration-150 group-active:opacity-100"
              aria-hidden
            />
            <span className="relative z-10">{label}</span>
          </button>
        ))}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <label className="block text-xs font-semibold text-slate-700">Prioridad</label>
        <div className="flex flex-wrap gap-2">
          {(["URGENT", "HIGH", "NORMAL", "LOW"] as TicketPriority[]).map((p) => (
            <button
              key={p}
              className={
                "rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-wide uppercase shadow-sm outline-none transition-all duration-200 select-none touch-manipulation " +
                "hover:-translate-y-px hover:shadow-md active:scale-95 active:shadow-inner active:duration-100 " +
                "focus-visible:ring-2 focus-visible:ring-rose-400/80 focus-visible:ring-offset-2 " +
                "disabled:pointer-events-none disabled:opacity-50 " +
                (currentPriority === p
                  ? "border-rose-700 bg-gradient-to-b from-rose-700 to-rose-800 text-white ring-1 ring-rose-900/20"
                  : "border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50/80 hover:text-rose-900")
              }
              onClick={() => patchTicket({ priority: p })}
              disabled={isPending}
              type="button"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <label className="block text-xs font-semibold text-slate-700">Modo de resolución</label>
        <select
          className="w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none transition ring-0 hover:border-rose-200 focus:border-rose-300 focus:ring-2 focus:ring-rose-200/80 disabled:cursor-not-allowed disabled:opacity-60"
          value={resolution}
          onChange={(e) => {
            const next = e.target.value;
            setResolution(next);
            patchTicket({ resolution: next });
          }}
          disabled={isPending}
        >
          <option value="">Sin definir</option>
          {resolutionModes.map((m) => (
            <option key={m} value={m}>
              {resolutionModeLabels[m]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <div className="font-semibold">Etiquetas sugeridas</div>
        <div>Diagnóstico técnico</div>
        <div>Certificado</div>
        <div>Escalado</div>
        <div>Acción manual pendiente</div>
      </div>
    </div>
  );
}

