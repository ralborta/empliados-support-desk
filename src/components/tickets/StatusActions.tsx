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
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isPending || currentStatus === "IN_PROGRESS"}
        onClick={() => updateStatus("IN_PROGRESS")}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      >
        En análisis
      </button>
      <button
        type="button"
        disabled={isPending || currentStatus === "WAITING_CUSTOMER"}
        onClick={() => updateStatus("WAITING_CUSTOMER")}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      >
        Esperando cliente
      </button>
      <button
        type="button"
        disabled={isPending || currentStatus === "RESOLVED"}
        onClick={() => updateStatus("RESOLVED")}
        className="rounded-lg bg-[#4a0e1c] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#6b1a2d] disabled:opacity-60"
      >
        Marcar resuelto
      </button>
      <button
        type="button"
        disabled={isPending || currentStatus === "CLOSED"}
        onClick={() => updateStatus("CLOSED")}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-60"
      >
        Cerrar
      </button>
    </div>
  );
}
