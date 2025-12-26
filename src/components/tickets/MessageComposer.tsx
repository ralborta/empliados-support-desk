"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageDirection, MessageFrom } from "@/generated/prisma";

export function MessageComposer({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<MessageDirection>("OUTBOUND");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          direction,
          from: direction === "OUTBOUND" ? MessageFrom.HUMAN : MessageFrom.HUMAN,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "No se pudo guardar el mensaje");
      } else {
        setText("");
        router.refresh();
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
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="OUTBOUND">Respuesta al cliente</option>
          <option value="INTERNAL_NOTE">Nota interna</option>
        </select>
      </div>
      <textarea
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none"
        rows={3}
        placeholder="Escribe una nota..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? "Guardando..." : direction === "OUTBOUND" ? "Responder" : "Guardar nota"}
        </button>
      </div>
    </form>
  );
}
