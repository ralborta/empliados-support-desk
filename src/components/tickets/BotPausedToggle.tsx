"use client";

import { useEffect, useState } from "react";

type Props = {
  customerId: string;
  /** Estado actual de pausa (controlado por el padre cuando es posible). */
  paused: boolean;
  /** Tras toggle exitoso o para sincronizar UI sin F5. */
  onPausedChange?: (paused: boolean) => void;
  /** Aviso externo (p. ej. sync fallida tras envío humano). */
  externalSyncPending?: boolean;
};

export function BotPausedToggle({
  customerId,
  paused,
  onPausedChange,
  externalSyncPending = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  // Eco local solo mientras el PUT está en vuelo; el padre es la fuente de verdad.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [syncHint, setSyncHint] = useState<string | null>(null);
  const shown = optimistic ?? paused;

  useEffect(() => {
    setOptimistic(null);
  }, [paused]);

  useEffect(() => {
    if (externalSyncPending && shown) {
      setSyncHint("Kira pausada acá; sincronización con el canal pendiente");
    }
  }, [externalSyncPending, shown]);

  const putPaused = async (next: boolean) => {
    const res = await fetch(`/api/clientes/${customerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botPaused: next }),
    });
    if (!res.ok) throw new Error("Error al actualizar");
    const data = await res.json().catch(() => ({}));
    const humanControl = data.humanControl as
      | { registered?: boolean; channelSyncOk?: boolean; syncStatus?: string }
      | undefined;
    onPausedChange?.(next);
    if (humanControl && humanControl.channelSyncOk === false) {
      setSyncHint(
        next
          ? "Kira pausada acá; sincronización con el canal pendiente"
          : "Reactivación registrada; sincronización con el canal pendiente",
      );
      return false;
    }
    setSyncHint(null);
    return true;
  };

  const toggle = async () => {
    setLoading(true);
    const next = !shown;
    setOptimistic(next);
    setSyncHint(null);
    try {
      await putPaused(next);
    } catch (e) {
      console.error(e);
      setOptimistic(null);
      setSyncHint(null);
    } finally {
      setLoading(false);
    }
  };

  /** Reaplica mute/blacklist sin cambiar el estado local de pausa. */
  const retryChannelSync = async () => {
    if (!shown) return;
    setReconciling(true);
    try {
      const ok = await putPaused(true);
      if (ok) setSyncHint(null);
    } catch (e) {
      console.error(e);
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={loading || reconciling}
        title={shown ? "Kira pausada — respondés vos" : "Kira activa en este chat"}
        className={`rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition active:scale-[0.98] disabled:opacity-50 ${
          shown
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {loading ? "…" : shown ? "Reactivar Kira" : "Pausar Kira"}
      </button>
      {syncHint ? (
        <div className="flex max-w-[16rem] flex-col items-end gap-0.5">
          <span className="text-right text-[10px] leading-snug text-amber-700">{syncHint}</span>
          {shown ? (
            <button
              type="button"
              onClick={retryChannelSync}
              disabled={reconciling || loading}
              className="text-[10px] font-semibold text-[#4a0e1c] underline-offset-2 hover:underline disabled:opacity-50"
            >
              {reconciling ? "Reintentando…" : "Reintentar sync del canal"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
