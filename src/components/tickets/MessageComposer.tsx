"use client";

import { useState } from "react";
import { Paperclip, Bold, Italic, List } from "lucide-react";
import type { MessageDirection } from "@/lib/types";
import { BotPausedToggle } from "./BotPausedToggle";

export function MessageComposer({
  ticketId,
  customerId,
  botPaused = false,
  onSent,
}: {
  ticketId: string;
  customerId?: string | null;
  botPaused?: boolean;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<MessageDirection>("OUTBOUND");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrapSelection = (before: string, after: string) => {
    const el = document.getElementById("ticket-reply-text") as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = text.slice(start, end);
    const next = text.slice(0, start) + before + selected + after + text.slice(end);
    setText(next);
  };

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
        if (onSent) {
          onSent();
        } else {
          window.location.reload();
        }
      }
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <span className="text-sm font-semibold text-slate-800">Responder</span>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as MessageDirection)}
          className="rounded-md border-0 bg-transparent text-xs text-slate-500 focus:outline-none"
        >
          <option value="OUTBOUND">Al cliente</option>
          <option value="INTERNAL_NOTE">Nota interna</option>
        </select>
      </div>

      <textarea
        id="ticket-reply-text"
        className="w-full resize-none border-0 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
        rows={4}
        placeholder="Escribir tu respuesta..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <div className="flex items-center gap-1">
          <label className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <Paperclip className="h-4 w-4" />
            <input
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => wrapSelection("*", "*")}
            title="Negrita"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => wrapSelection("_", "_")}
            title="Cursiva"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => setText((t) => (t ? `${t}\n• ` : "• "))}
            title="Lista"
          >
            <List className="h-4 w-4" />
          </button>
          {file ? <span className="ml-1 max-w-[120px] truncate text-xs text-violet-600">{file.name}</span> : null}
        </div>

        <div className="flex items-center gap-2">
          {customerId && direction === "OUTBOUND" ? (
            <BotPausedToggle customerId={customerId} initialPaused={botPaused} />
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60"
          >
            {loading ? "Enviando…" : "Enviar respuesta"}
          </button>
        </div>
      </div>

      {error ? <p className="px-4 pb-3 text-xs text-red-600">{error}</p> : null}
    </form>
  );
}
