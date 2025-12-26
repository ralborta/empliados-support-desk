"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { TicketStatus } from "@/lib/types";

export function StatusActions({
  ticketId,
  currentStatus,
}: {
  ticketId: string;
  currentStatus: TicketStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const updateStatus = (status: TicketStatus) => {
    startTransition(async () => {
      await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={isPending || currentStatus === "WAITING_CUSTOMER"}
        onClick={() => updateStatus("WAITING_CUSTOMER")}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        Esperando Cliente
      </button>
      <button
        type="button"
        disabled={isPending || currentStatus === "RESOLVED"}
        onClick={() => updateStatus("RESOLVED")}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        Marcar como Resuelto
      </button>
      <button
        type="button"
        disabled={isPending || currentStatus === "CLOSED"}
        onClick={() => updateStatus("CLOSED")}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        Cerrar
      </button>
    </div>
  );
}
