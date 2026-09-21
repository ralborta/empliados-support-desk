"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
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
    <div className="rounded-lg border border-slate-200/90 bg-slate-50/50 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Resumen IA</h3>
        </div>
        <button
          type="button"
          onClick={refreshSummary}
          disabled={loading}
          className="text-[11px] font-medium text-[#4a0e1c] hover:underline disabled:opacity-50"
        >
          {loading ? "Generando…" : summary ? "Actualizar" : "Generar"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          <span>Generando resumen…</span>
        </div>
      ) : (
        <div className="space-y-1.5 text-sm text-slate-700">
          <p>
            <span className="font-medium text-slate-800">Motivo:</span>{" "}
            {incidentLabel || "Sin clasificar"}
          </p>
          {keyData ? (
            <p className="text-xs">
              <span className="font-medium text-slate-800">Datos clave:</span> {keyData}
            </p>
          ) : null}
          <p className="text-xs">
            <span className="font-medium text-slate-800">Urgencia sugerida:</span>{" "}
            <span className="font-medium text-slate-700">{urgencyLabel}</span>
          </p>
          {summary ? (
            <p className="mt-2 border-t border-slate-200/80 pt-2 text-xs leading-relaxed whitespace-pre-wrap text-slate-600">
              {summary}
            </p>
          ) : (
            <p className="text-[11px] italic text-slate-500">
              Sin texto adicional. Generá el resumen para ampliar el análisis.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
