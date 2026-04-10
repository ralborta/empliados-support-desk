"use client";

import { useEffect, useState } from "react";

interface ConversationSummaryProps {
  ticketId: string;
  initialSummary?: string | null;
}

export function ConversationSummary({ ticketId, initialSummary }: ConversationSummaryProps) {
  const [summary, setSummary] = useState(initialSummary || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Actualizar el resumen cuando cambia
    setSummary(initialSummary || null);
  }, [initialSummary]);

  const refreshSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/summary`, {
        method: "POST",
      });
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

  if (!summary && !loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">📋 Resumen de la conversación</h3>
          <button
            onClick={refreshSummary}
            className="text-xs text-rose-700 hover:text-rose-800 font-medium"
          >
            Generar
          </button>
        </div>
        <p className="text-xs text-slate-500 italic">
          No hay resumen aún. Click en "Generar" para crear uno con IA.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-red-50 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-rose-900">📋 Resumen IA</h3>
        <button
          onClick={refreshSummary}
          disabled={loading}
          className="text-xs text-rose-700 hover:text-rose-800 font-medium disabled:opacity-50"
        >
          {loading ? "⏳" : "🔄"}
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-rose-700">
          <div className="animate-spin h-4 w-4 border-2 border-rose-700 border-t-transparent rounded-full"></div>
          <span>Generando resumen...</span>
        </div>
      ) : (
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {summary}
        </p>
      )}
      <div className="mt-3 pt-3 border-t border-rose-100">
        <p className="text-xs text-rose-700">
          💡 Se actualiza automáticamente con cada mensaje
        </p>
      </div>
    </div>
  );
}
