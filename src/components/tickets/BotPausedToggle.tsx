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
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      title={paused ? "Atilio pausado — respondés vos" : "Atilio activo en este chat"}
      className={`rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition active:scale-[0.98] disabled:opacity-50 ${
        paused
          ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {loading ? "…" : paused ? "Reactivar Atilio" : "Pausar Atilio"}
    </button>
  );
}
