"use client";

import { useEffect, useState } from "react";
import { priorityLabels } from "@/lib/tickets";

interface ConversationSummaryProps {
  ticketId: string;
  initialSummary?: string | null;
  incidentLabel?: string;
  plate?: string;
  company?: string;
  priority?: string;
}

export function ConversationSummary({
  ticketId,
  initialSummary,
  incidentLabel,
  plate,
  company,
  priority,
}: ConversationSummaryProps) {
  const [summary, setSummary] = useState(initialSummary || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSummary(initialSummary || null);
  }, [initialSummary]);

  const refreshSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/summary`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSummary(data.aiSummary);
      }
    } catch (error) {
      console.error("Error al actualizar resumen:", error);
    } finally {
      setLoading(false);
    }
  };

  const priorityKey = priority as keyof typeof priorityLabels | undefined;
  const urgencyLabel = priorityKey ? priorityLabels[priorityKey] : priority || "—";
  const keyData = [plate && `matrícula ${plate}`, company && `empresa ${company}`]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="rounded-xl border border-rose-200/80 bg-gradient-to-br from-rose-50 to-pink-50 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-rose-900">Resumen IA</h3>
        <button
          type="button"
          onClick={refreshSummary}
          disabled={loading}
          className="text-xs font-medium text-rose-700 hover:text-rose-900 disabled:opacity-50"
        >
          {loading ? "Generando…" : summary ? "Actualizar" : "Generar"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-rose-700">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-rose-700 border-t-transparent" />
          <span>Generando resumen…</span>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            <span className="font-semibold text-slate-800">Motivo:</span>{" "}
            {incidentLabel || "Sin clasificar"}
          </p>
          {keyData ? (
            <p>
              <span className="font-semibold text-slate-800">Datos clave:</span> {keyData}
            </p>
          ) : null}
          <p>
            <span className="font-semibold text-slate-800">Urgencia sugerida:</span>{" "}
            <span className="font-medium uppercase text-emerald-700">{urgencyLabel}</span>
          </p>
          {summary ? (
            <p className="mt-2 border-t border-rose-100 pt-2 text-sm leading-relaxed whitespace-pre-wrap text-slate-600">
              {summary}
            </p>
          ) : (
            <p className="mt-2 text-xs italic text-slate-500">
              Sin texto adicional. Generá el resumen para ampliar el análisis.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
