"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Props = {
  customerId: string;
  initialPaused: boolean;
};

export function BotPausedToggle({ customerId, initialPaused }: Props) {
  const router = useRouter();
  const [paused, setPaused] = useState(initialPaused);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPaused(initialPaused);
  }, [initialPaused]);

  const toggle = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clientes/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botPaused: !paused }),
      });
      if (!res.ok) throw new Error("Error al actualizar");
      setPaused(!paused);
      router.refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-100 bg-rose-50/50 px-2.5 py-1.5">
      <span className="text-xs text-slate-600">
        <span className="font-semibold text-slate-700">Atilio:</span>{" "}
        {paused ? (
          <span className="font-medium text-amber-700">⏸️ Pausado (respondés vos)</span>
        ) : (
          <span className="text-slate-500">Activo</span>
        )}
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-900 shadow-sm transition hover:bg-rose-50 active:scale-[0.98] disabled:opacity-50"
      >
        {loading ? "…" : paused ? "Reactivar Atilio" : "Pausar Atilio"}
      </button>
    </div>
  );
}
