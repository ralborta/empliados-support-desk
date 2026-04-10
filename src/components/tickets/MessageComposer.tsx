"use client";

import { useState } from "react";
import type { MessageDirection } from "@/lib/types";
import { BotPausedToggle } from "./BotPausedToggle";

export function MessageComposer({
  ticketId,
  customerId,
  botPaused = false,
}: {
  ticketId: string;
  customerId?: string | null;
  botPaused?: boolean;
}) {
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<MessageDirection>("OUTBOUND");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("text", text);
      formData.append("direction", direction);
      formData.append("from", "HUMAN");
      if (file) formData.append("file", file);
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "No se pudo guardar el mensaje");
      } else {
        setText("");
        setFile(null);
        // Forzar recarga completa de la página para mostrar el nuevo mensaje
        window.location.reload();
      }
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-slate-700">Escribe una nota o respuesta</label>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as MessageDirection)}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-rose-500 focus:outline-none"
        >
          <option value="OUTBOUND">Respuesta al cliente</option>
          <option value="INTERNAL_NOTE">Nota interna</option>
        </select>
      </div>
      <textarea
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-rose-500 focus:outline-none"
        rows={3}
        placeholder="Escribe una nota..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-rose-50 file:px-2 file:py-1 file:text-rose-700"
        />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {customerId ? (
          <BotPausedToggle customerId={customerId} initialPaused={botPaused} />
        ) : null}
        <div className="flex justify-end sm:ml-auto">
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-800 disabled:opacity-60"
          >
            {loading ? "Guardando..." : direction === "OUTBOUND" ? "Responder" : "Guardar nota"}
          </button>
        </div>
      </div>
    </form>
  );
}
