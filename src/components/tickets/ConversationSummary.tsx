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
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
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
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-indigo-900">📋 Resumen IA</h3>
        <button
          onClick={refreshSummary}
          disabled={loading}
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
        >
          {loading ? "⏳" : "🔄"}
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-indigo-600">
          <div className="animate-spin h-4 w-4 border-2 border-indigo-600 border-t-transparent rounded-full"></div>
          <span>Generando resumen...</span>
        </div>
      ) : (
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {summary}
        </p>
      )}
      <div className="mt-3 pt-3 border-t border-indigo-100">
        <p className="text-xs text-indigo-600">
          💡 Se actualiza automáticamente con cada mensaje
        </p>
      </div>
    </div>
  );
}
