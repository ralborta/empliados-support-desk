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

  const addTemplateNote = (text: string) => {
    startTransition(async () => {
      await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          direction: "INTERNAL_NOTE",
          from: "HUMAN",
          rawPayload: { simulated: true },
        }),
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-sm font-semibold text-slate-800">Acciones rápidas</div>
      <div className="grid grid-cols-2 gap-2">
        <button className="rounded-lg border px-3 py-2 text-xs" disabled={isPending} onClick={() => patchTicket({ status: "WAITING_CUSTOMER" })}>Solicitar más datos</button>
        <button className="rounded-lg border px-3 py-2 text-xs" disabled={isPending} onClick={() => patchTicket({ status: "IN_PROGRESS" })}>Marcar en análisis</button>
        <button className="rounded-lg border px-3 py-2 text-xs" disabled={isPending} onClick={() => patchTicket({ status: "IN_PROGRESS", resolution: "BACKOFFICE_DERIVED" })}>Derivar</button>
        <button className="rounded-lg border px-3 py-2 text-xs" disabled={isPending} onClick={() => patchTicket({ status: "RESOLVED", resolution: "CHAT_RESOLVED" })}>Resolver</button>
        <button className="rounded-lg border px-3 py-2 text-xs" disabled={isPending} onClick={() => patchTicket({ status: "CLOSED", resolution: "CLOSED_NO_ACTION" })}>Cerrar</button>
        <button className="rounded-lg border px-3 py-2 text-xs" disabled={isPending} onClick={() => addTemplateNote("[Acción manual pendiente] Se requiere validación interna.")}>Nota interna</button>
      </div>

      <div className="space-y-2 border-t pt-3">
        <label className="block text-xs font-semibold text-slate-700">Prioridad</label>
        <div className="flex flex-wrap gap-2">
          {(["URGENT", "HIGH", "NORMAL", "LOW"] as TicketPriority[]).map((p) => (
            <button
              key={p}
              className={`rounded-full border px-3 py-1 text-xs ${currentPriority === p ? "bg-slate-900 text-white" : ""}`}
              onClick={() => patchTicket({ priority: p })}
              disabled={isPending}
              type="button"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <label className="block text-xs font-semibold text-slate-700">Modo de resolución</label>
        <select
          className="w-full rounded-lg border px-2 py-2 text-sm"
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

      <div className="space-y-1 border-t pt-3 text-xs text-slate-600">
        <div className="font-semibold">Etiquetas demo</div>
        <div>Diagnóstico simulado</div>
        <div>Certificado simulado</div>
        <div>Escalado simulado</div>
        <div>Acción manual pendiente</div>
      </div>
    </div>
  );
}

