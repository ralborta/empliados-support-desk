"use client";

import { useEffect, useState } from "react";

type SyncStatus = "idle" | "pending" | "synced" | "error";

type Props = {
  customerId: string;
  /** Estado actual de pausa local (botPausedAt). */
  paused: boolean;
  /** Sync canal desde servidor (poll). */
  channelSyncStatus?: SyncStatus | string | null;
  /** auto = takeover; manual = botón Pausar Kira. */
  pauseSource?: "auto" | "manual" | string | null;
  /** Tras toggle exitoso o para sincronizar UI sin F5. */
  onPausedChange?: (paused: boolean) => void;
  onSyncStatusChange?: (status: SyncStatus) => void;
  /** Aviso externo (p. ej. sync pendiente tras envío humano). */
  externalSyncPending?: boolean;
};

function hintFor(paused: boolean, syncStatus: SyncStatus | null): string | null {
  if (!syncStatus || syncStatus === "synced" || syncStatus === "idle") return null;
  if (syncStatus === "pending") {
    return paused
      ? "Kira pausada acá; sincronización con el canal pendiente"
      : "Reactivación registrada; sincronización con el canal pendiente";
  }
  if (syncStatus === "error") {
    return paused
      ? "Kira pausada acá; falló la sync con el canal"
      : "Reactivación local OK; falló la sync con el canal";
  }
  return null;
}

export function BotPausedToggle({
  customerId,
  paused,
  channelSyncStatus = null,
  pauseSource = null,
  onPausedChange,
  onSyncStatusChange,
  externalSyncPending = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [localSync, setLocalSync] = useState<SyncStatus | null>(null);
  const shown = optimistic ?? paused;
  const effectiveSync: SyncStatus | null =
    localSync ??
    (typeof channelSyncStatus === "string" ? (channelSyncStatus as SyncStatus) : null) ??
    (externalSyncPending ? "pending" : null);
  const syncHint = hintFor(shown, effectiveSync);

  useEffect(() => {
    setOptimistic(null);
  }, [paused]);

  useEffect(() => {
    // El poll del padre es fuente de verdad cuando llega synced/error.
    if (channelSyncStatus === "synced" || channelSyncStatus === "error") {
      setLocalSync(null);
    }
  }, [channelSyncStatus]);

  const putPaused = async (next: boolean, forceChannelSync = false) => {
    const res = await fetch(`/api/clientes/${customerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botPaused: next, forceChannelSync }),
    });
    if (!res.ok) throw new Error("Error al actualizar");
    const data = await res.json().catch(() => ({}));
    const humanControl = data.humanControl as
      | {
          registered?: boolean;
          channelSyncOk?: boolean;
          syncStatus?: SyncStatus;
          localPaused?: boolean;
        }
      | undefined;
    onPausedChange?.(next);
    const status = (humanControl?.syncStatus ??
      (humanControl?.channelSyncOk === false ? "pending" : "synced")) as SyncStatus;
    setLocalSync(status === "synced" ? null : status);
    onSyncStatusChange?.(status);
    return status === "synced";
  };

  const toggle = async () => {
    setLoading(true);
    const next = !shown;
    setOptimistic(next);
    setLocalSync("pending");
    try {
      await putPaused(next, false);
    } catch (e) {
      console.error(e);
      setOptimistic(null);
      setLocalSync(null);
    } finally {
      setLoading(false);
    }
  };

  /** Reaplica mute/blacklist con nueva generation; no toca botPausedSource. */
  const retryChannelSync = async () => {
    setReconciling(true);
    setLocalSync("pending");
    try {
      const res = await fetch(`/api/clientes/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryChannelSync: true }),
      });
      if (!res.ok) throw new Error("Error al reintentar sync");
      const data = await res.json().catch(() => ({}));
      const humanControl = data.humanControl as
        | { syncStatus?: SyncStatus; channelSyncOk?: boolean }
        | undefined;
      const status = (humanControl?.syncStatus ??
        (humanControl?.channelSyncOk === false ? "pending" : "synced")) as SyncStatus;
      setLocalSync(status === "synced" ? null : status);
      onSyncStatusChange?.(status);
    } catch (e) {
      console.error(e);
      setLocalSync("error");
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
        title={
          shown
            ? pauseSource === "manual"
              ? "Kira pausada manualmente — solo se reactiva con este botón"
              : "Kira pausada por atención humana — Resolver puede reactivarla"
            : "Kira activa en este chat"
        }
        className={`rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition active:scale-[0.98] disabled:opacity-50 ${
          shown
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {loading ? "…" : shown ? "Reactivar Kira" : "Pausar Kira"}
      </button>
      {shown && pauseSource === "manual" && !syncHint ? (
        <span className="text-right text-[10px] leading-snug text-amber-700">Pausa manual</span>
      ) : null}
      {syncHint ? (
        <div className="flex max-w-[16rem] flex-col items-end gap-0.5">
          <span className="text-right text-[10px] leading-snug text-amber-700">{syncHint}</span>
          <button
            type="button"
            onClick={retryChannelSync}
            disabled={reconciling || loading}
            className="text-[10px] font-semibold text-[#4a0e1c] underline-offset-2 hover:underline disabled:opacity-50"
          >
            {reconciling ? "Reintentando…" : "Reintentar sync del canal"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
