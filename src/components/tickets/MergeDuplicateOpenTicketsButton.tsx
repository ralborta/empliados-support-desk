"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GitMerge } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { waraAccent } from "@/lib/ui/waraTheme";

/**
 * Ejecuta POST /api/admin/merge-duplicate-open-tickets (ver `ticketThreading.ts` para la regla).
 * Solo administradores (`visible`).
 */
export function MergeDuplicateOpenTicketsButton({
  visible = true,
  compact = false,
  className = "",
}: {
  visible?: boolean;
  compact?: boolean;
  className?: string;
}) {
  if (!visible) return null;
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = async () => {
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
      setConfirmOpen(false);
    }
  };

  const tooltip =
    "Une tickets abiertos duplicados del mismo cliente en uno solo (el más reciente).";

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={loading}
          title={tooltip}
          className={`inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-white disabled:opacity-50 ${waraAccent.ring}`}
        >
          <GitMerge className="h-3.5 w-3.5" aria-hidden />
          {loading ? "Fusionando…" : "Fusionar duplicados"}
        </button>
        {lastMessage ? (
          <span className="max-w-[140px] truncate text-[10px] text-slate-500" title={lastMessage}>
            {lastMessage}
          </span>
        ) : null}
        <ConfirmDialog
          open={confirmOpen}
          title="Fusionar tickets duplicados"
          description="¿Fusionar tickets abiertos duplicados por cliente? Los mensajes quedarán en un solo ticket (el más reciente). Esta acción no se puede deshacer."
          confirmLabel="Fusionar"
          cancelLabel="Cancelar"
          variant="danger"
          loading={loading}
          onConfirm={run}
          onCancel={() => {
            if (!loading) setConfirmOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-end gap-1 text-right ${className}`}>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        title={tooltip}
        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-50"
      >
        {loading ? "Fusionando…" : "Fusionar duplicados abiertos"}
      </button>
      {lastMessage ? <p className="text-xs text-slate-700">{lastMessage}</p> : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Fusionar tickets duplicados"
        description="¿Fusionar tickets abiertos duplicados por cliente? Los mensajes quedarán en un solo ticket (el más reciente). Esta acción no se puede deshacer."
        confirmLabel="Fusionar"
        cancelLabel="Cancelar"
        variant="danger"
        loading={loading}
        onConfirm={run}
        onCancel={() => {
          if (!loading) setConfirmOpen(false);
        }}
      />
    </div>
  );
}
