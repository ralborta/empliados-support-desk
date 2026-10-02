"use client";

import { useEffect, useState } from "react";

type Props = {
  customerId: string;
  /** Estado actual de pausa (controlado por el padre cuando es posible). */
  paused: boolean;
  /** Tras toggle exitoso o para sincronizar UI sin F5. */
  onPausedChange?: (paused: boolean) => void;
};

export function BotPausedToggle({ customerId, paused, onPausedChange }: Props) {
  const [loading, setLoading] = useState(false);
  // Eco local solo mientras el PUT está en vuelo; el padre es la fuente de verdad.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? paused;

  useEffect(() => {
    setOptimistic(null);
  }, [paused]);

  const toggle = async () => {
    setLoading(true);
    const next = !shown;
    setOptimistic(next);
    try {
      const res = await fetch(`/api/clientes/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botPaused: next }),
      });
      if (!res.ok) throw new Error("Error al actualizar");
      onPausedChange?.(next);
    } catch (e) {
      console.error(e);
      setOptimistic(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      title={shown ? "Kira pausada — respondés vos" : "Kira activa en este chat"}
      className={`rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition active:scale-[0.98] disabled:opacity-50 ${
        shown
          ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {loading ? "…" : shown ? "Reactivar Kira" : "Pausar Kira"}
    </button>
  );
}
