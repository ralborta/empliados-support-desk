"use client";

import { useEffect, useState } from "react";
import { Bot, PauseCircle, UserRound } from "lucide-react";

export function TicketV2HeaderBadges({
  ticketId,
  botPaused,
}: {
  ticketId: string;
  botPaused: boolean;
}) {
  const [hasV2, setHasV2] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/v2-operation`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setHasV2(Boolean(data.hasV2Operation));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  if (!hasV2 && !botPaused) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hasV2 ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200/80">
          <Bot className="h-3 w-3 text-[#4a0e1c]" aria-hidden />
          Atilio V2
        </span>
      ) : null}
      {hasV2 ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200/80">
          <UserRound className="h-3 w-3" aria-hidden />
          Derivado a humano
        </span>
      ) : null}
      {botPaused ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200/80">
          <PauseCircle className="h-3 w-3" aria-hidden />
          IA pausada
        </span>
      ) : null}
    </div>
  );
}
