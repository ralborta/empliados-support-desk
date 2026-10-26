"use client";

import { useEffect, useState } from "react";
import { Bot, PauseCircle, PlayCircle } from "lucide-react";
import { formatDateTimeAR } from "@/lib/formatDateTimeAR";

type V2Op = {
  tramite: string;
  unit?: { patente?: string; label?: string } | null;
  operationIdShort: string;
  status: string;
  createdAt: string;
  externalResult?: string | null;
  unknownOutcome?: boolean;
  reconciliationRequired?: boolean;
  collectedData?: Record<string, unknown>;
  derivationReason?: string | null;
};

function summarizeCollected(data?: Record<string, unknown>): string | null {
  if (!data || Object.keys(data).length === 0) return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v == null || v === "") continue;
    if (typeof v === "object") continue;
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.length ? parts.slice(0, 4).join(" · ") : null;
}

export function V2OperationPanel({
  ticketId,
  botPaused = false,
}: {
  ticketId: string;
  botPaused?: boolean;
}) {
  const [op, setOp] = useState<V2Op | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/v2-operation`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.hasV2Operation) setOp(data.operation);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-3 animate-pulse">
        <div className="h-3 w-24 rounded bg-slate-200" />
      </div>
    );
  }
  if (!op) return null;

  const unitLabel = op.unit?.label ?? op.unit?.patente ?? "—";
  const collected = summarizeCollected(op.collectedData);

  return (
    <div className="rounded-lg border border-[#4a0e1c]/15 bg-white p-3 shadow-sm ring-1 ring-[#4a0e1c]/5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#4a0e1c]">
          <Bot className="h-3.5 w-3.5" aria-hidden />
          Operación V2
        </h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            botPaused
              ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80"
              : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/70"
          }`}
        >
          {botPaused ? (
            <>
              <PauseCircle className="h-3 w-3" aria-hidden /> IA pausada
            </>
          ) : (
            <>
              <PlayCircle className="h-3 w-3" aria-hidden /> IA activa
            </>
          )}
        </span>
      </div>
      <dl className="grid gap-1.5 text-xs">
        <Row label="Trámite" value={op.tramite} />
        <Row label="Unidad" value={unitLabel} />
        <Row label="Estado" value={op.status} />
        <Row label="ID operación" value={`${op.operationIdShort}…`} mono />
        <Row label="Fecha" value={formatDateTimeAR(op.createdAt)} />
        {op.externalResult ? <Row label="Resultado" value={op.externalResult} /> : null}
        {op.unknownOutcome ? (
          <p className="rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-800 ring-1 ring-red-100">
            Resultado incierto — requiere revisión
          </p>
        ) : null}
        {!op.unknownOutcome && op.reconciliationRequired ? (
          <p className="text-[11px] font-medium text-amber-800">Reconciliación pendiente</p>
        ) : (
          !op.unknownOutcome && (
            <Row label="Reconciliación" value="No requerida" muted />
          )
        )}
        {op.derivationReason ? <Row label="Motivo derivación" value={op.derivationReason} /> : null}
        {collected ? <Row label="Datos recopilados" value={collected} /> : null}
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  muted,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd
        className={`text-right font-medium ${mono ? "font-mono text-[11px]" : ""} ${muted ? "text-slate-500" : "text-slate-800"}`}
      >
        {value}
      </dd>
    </div>
  );
}
