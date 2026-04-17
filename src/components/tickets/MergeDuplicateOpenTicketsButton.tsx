"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Ejecuta POST /api/admin/merge-duplicate-open-tickets (ver `ticketThreading.ts` para la regla).
 */
export function MergeDuplicateOpenTicketsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const run = async () => {
    if (
      !confirm(
        "¿Fusionar tickets abiertos duplicados por cliente? Los mensajes quedarán en un solo ticket (el más reciente). Esta acción no se puede deshacer."
      )
    ) {
      return;
    }
    setLoading(true);
    setLastMessage(null);
    try {
      const res = await fetch("/api/admin/merge-duplicate-open-tickets", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLastMessage(data.error || "Error");
        return;
      }
      setLastMessage(data.message || "Listo.");
      router.refresh();
    } catch {
      setLastMessage("Error de red");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex max-w-md flex-col items-end gap-1 text-right">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-50"
      >
        {loading ? "Fusionando…" : "Fusionar duplicados abiertos"}
      </button>
      <p className="text-[11px] leading-snug text-slate-500">
        Un solo ticket abierto por cliente: une conversaciones abiertas repetidas en el ticket más activo.
      </p>
      {lastMessage ? <p className="text-xs text-slate-700">{lastMessage}</p> : null}
    </div>
  );
}
