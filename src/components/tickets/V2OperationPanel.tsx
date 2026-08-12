"use client";

import { useEffect, useState } from "react";
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

export function V2OperationPanel({ ticketId }: { ticketId: string }) {
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

  if (loading) return null;
  if (!op) return null;

  const unitLabel = op.unit?.label ?? op.unit?.patente ?? "—";

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-indigo-900">Operación V2</h3>
      <dl className="mt-3 grid gap-2 text-sm text-indigo-950">
        <div className="flex justify-between gap-4">
          <dt className="text-indigo-700">Trámite</dt>
          <dd className="font-medium">{op.tramite}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-indigo-700">Unidad</dt>
          <dd className="font-medium">{unitLabel}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-indigo-700">operationId</dt>
          <dd className="font-mono text-xs">{op.operationIdShort}…</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-indigo-700">Estado</dt>
          <dd className="font-medium">{op.status}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-indigo-700">Fecha</dt>
          <dd>{formatDateTimeAR(op.createdAt)}</dd>
        </div>
        {op.externalResult ? (
          <div>
            <dt className="text-indigo-700">Resultado</dt>
            <dd className="mt-0.5">{op.externalResult}</dd>
          </div>
        ) : null}
        {op.unknownOutcome ? (
          <p className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
            Resultado externo incierto — requiere reconciliación manual
          </p>
        ) : null}
        {op.reconciliationRequired && !op.unknownOutcome ? (
          <p className="text-xs text-amber-800">Reconciliación pendiente</p>
        ) : null}
        {op.derivationReason ? (
          <div>
            <dt className="text-indigo-700">Motivo derivación</dt>
            <dd className="mt-0.5">{op.derivationReason}</dd>
          </div>
        ) : null}
        {op.collectedData && Object.keys(op.collectedData).length > 0 ? (
          <div>
            <dt className="text-indigo-700">Datos recopilados</dt>
            <dd className="mt-1 whitespace-pre-wrap font-mono text-xs">
              {JSON.stringify(op.collectedData, null, 2)}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
