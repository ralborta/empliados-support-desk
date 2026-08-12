"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { priorityLabels } from "@/lib/tickets";
import { waraAccent } from "@/lib/ui/waraTheme";

type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export function TicketPriorityPanel({
  ticketId,
  currentPriority,
}: {
  ticketId: string;
  currentPriority: TicketPriority;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const patchPriority = (priority: TicketPriority) => {
    startTransition(async () => {
      await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Prioridad</p>
      <div className="flex flex-wrap gap-1.5">
        {(["URGENT", "HIGH", "NORMAL", "LOW"] as TicketPriority[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${waraAccent.ring} disabled:opacity-50 ${
              currentPriority === p
                ? "border-[#4a0e1c] bg-[#4a0e1c] text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-[#4a0e1c]/30 hover:bg-[#4a0e1c]/[0.03]"
            }`}
            onClick={() => patchPriority(p)}
            disabled={isPending}
          >
            {priorityLabels[p]}
          </button>
        ))}
      </div>
    </div>
  );
}
