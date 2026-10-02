"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Bold, Italic, List } from "lucide-react";
import type { MessageDirection } from "@/lib/types";
import { BotPausedToggle } from "./BotPausedToggle";

function draftKey(ticketId: string): string {
  return `kira-draft:${ticketId}`;
}

function attemptKey(ticketId: string): string {
  return `kira-attempt:${ticketId}`;
}

function readDraft(ticketId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(draftKey(ticketId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(ticketId: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!value.trim()) sessionStorage.removeItem(draftKey(ticketId));
    else sessionStorage.setItem(draftKey(ticketId), value);
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredAttemptId(ticketId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(attemptKey(ticketId));
  } catch {
    return null;
  }
}

function writeStoredAttemptId(ticketId: string, attemptId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!attemptId) sessionStorage.removeItem(attemptKey(ticketId));
    else sessionStorage.setItem(attemptKey(ticketId), attemptId);
  } catch {
    /* ignore */
  }
}

function newAttemptId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function MessageComposer({
  ticketId,
  customerId,
  botPaused = false,
  onBotPausedChange,
  onSent,
  embedded = false,
}: {
  ticketId: string;
  customerId?: string | null;
  botPaused?: boolean;
  /** Actualiza el badge/botón en el ticket sin F5 (pausa automática al enviar). */
  onBotPausedChange?: (paused: boolean) => void;
  onSent?: () => void;
  embedded?: boolean;
}) {
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<MessageDirection>("OUTBOUND");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const sentTextRef = useRef<string>("");

  useEffect(() => {
    setText(readDraft(ticketId));
    attemptIdRef.current = readStoredAttemptId(ticketId);
    setError(null);
    setStatusHint(null);
  }, [ticketId]);

  const updateText = (value: string) => {
    setText(value);
    writeDraft(ticketId, value);
    // Cambiar el borrador invalida el intento anterior (contenido inmutable).
    if (
      attemptIdRef.current &&
      sentTextRef.current &&
      value.trim() !== sentTextRef.current.trim()
    ) {
      attemptIdRef.current = null;
      writeStoredAttemptId(ticketId, null);
      sentTextRef.current = "";
      setStatusHint(null);
    }
  };

  const clearDraftIfUnchanged = (sentText: string) => {
    // Solo limpia si el borrador sigue siendo el del intento confirmado.
    setText((current) => {
      if (current.trim() === sentText.trim()) {
        writeDraft(ticketId, "");
        return "";
      }
      return current;
    });
  };

  const waitForAttemptConfirmation = async (attemptId: string, sentText: string) => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/tickets/${ticketId}/messages`);
        if (!res.ok) continue;
        const data = await res.json();
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const match = messages.find(
          (m: { clientAttemptId?: string | null; deliveryStatus?: string | null }) =>
            m.clientAttemptId === attemptId && m.deliveryStatus === "sent",
        );
        if (match) {
          clearDraftIfUnchanged(sentText);
          attemptIdRef.current = null;
          writeStoredAttemptId(ticketId, null);
          setStatusHint(null);
          setFile(null);
          onSent?.();
          return;
        }
      } catch {
        /* ignore poll errors */
      }
    }
    setStatusHint(
      "Sigue en confirmación pendiente. Si el cliente lo recibió, no reenvíes: esperá o refrescá el hilo.",
    );
  };

  const wrapSelection = (before: string, after: string) => {
    const el = document.getElementById("ticket-reply-text") as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = text.slice(start, end);
    const next = text.slice(0, start) + before + selected + after + text.slice(end);
    updateText(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setLoading(true);
    setError(null);
    setStatusHint(null);

    const outboundText = text;
    sentTextRef.current = outboundText;

    if (direction === "OUTBOUND") {
      if (!attemptIdRef.current) {
        attemptIdRef.current = newAttemptId();
        writeStoredAttemptId(ticketId, attemptIdRef.current);
      }
    }

    try {
      const formData = new FormData();
      formData.append("text", text);
      formData.append("direction", direction);
      formData.append("from", "HUMAN");
      if (direction === "OUTBOUND" && attemptIdRef.current) {
        formData.append("clientAttemptId", attemptIdRef.current);
      }
      if (file) formData.append("file", file);

      const res = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      const deliveryStatus = String(data.deliveryStatus || "");

      if (direction === "OUTBOUND") {
        // Takeover local aunque la confirmación del proveedor esté pendiente.
        onBotPausedChange?.(true);
        onSent?.();

        if (deliveryStatus === "sent" || (res.ok && !deliveryStatus && res.status === 200)) {
          clearDraftIfUnchanged(outboundText);
          attemptIdRef.current = null;
          writeStoredAttemptId(ticketId, null);
          setFile(null);
          setStatusHint(null);
        } else if (deliveryStatus === "confirmation_pending" || res.status === 202) {
          setStatusHint("Confirmación pendiente del proveedor…");
          setFile(null);
          void waitForAttemptConfirmation(attemptIdRef.current || "", outboundText);
        } else if (deliveryStatus === "failed" || res.status === 422 || !res.ok) {
          if (data.code === "ATTEMPT_CONTENT_MISMATCH") {
            attemptIdRef.current = null;
            writeStoredAttemptId(ticketId, null);
            setError("El texto cambió: se enviará como un mensaje nuevo.");
          } else {
            setError(data.error || "No se pudo enviar el mensaje al cliente");
          }
          // Conserva attemptId + borrador para reintento seguro (mismo id) si el contenido no cambió.
        } else {
          clearDraftIfUnchanged(outboundText);
          attemptIdRef.current = null;
          writeStoredAttemptId(ticketId, null);
          setFile(null);
        }
      } else if (!res.ok) {
        setError(data.error || "No se pudo guardar el mensaje");
      } else {
        updateText("");
        setFile(null);
        if (onSent) onSent();
        else window.location.reload();
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
      className={
        embedded
          ? "bg-transparent"
          : "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      }
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
        <span className="text-xs font-semibold text-slate-800">Responder</span>
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
        className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
        rows={embedded ? 3 : 4}
        placeholder="Escribir tu respuesta… Enter envía · Shift+Enter salto de línea"
        value={text}
        onChange={(e) => updateText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (loading || (!text.trim() && !file)) return;
          e.currentTarget.form?.requestSubmit();
        }}
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
            onClick={() => updateText(text ? `${text}\n• ` : "• ")}
            title="Lista"
          >
            <List className="h-4 w-4" />
          </button>
          {file ? <span className="ml-1 max-w-[120px] truncate text-xs text-[#4a0e1c]">{file.name}</span> : null}
        </div>

        <div className="flex items-center gap-2">
          {customerId && direction === "OUTBOUND" ? (
            <BotPausedToggle
              customerId={customerId}
              paused={botPaused}
              onPausedChange={onBotPausedChange}
            />
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-[#4a0e1c] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#6b1428] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a0e1c]/30 disabled:opacity-60 sm:text-sm sm:px-4 sm:py-2"
          >
            {loading ? "Enviando…" : "Enviar respuesta"}
          </button>
        </div>
      </div>

      {error ? <p className="px-4 pb-3 text-xs text-red-600">{error}</p> : null}
      {statusHint ? <p className="px-4 pb-3 text-xs text-amber-700">{statusHint}</p> : null}
    </form>
  );
}
