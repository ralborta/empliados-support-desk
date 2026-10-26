"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Stage = "loading" | "form" | "done" | "gone" | "error";

export default function ServiceFeedbackSurveyPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? "");
  const [stage, setStage] = useState<Stage>("loading");
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const [resolved, setResolved] = useState<"yes" | "no" | "">("");
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStage("gone");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/s/${encodeURIComponent(token)}`);
        const data = (await res.json()) as {
          ok?: boolean;
          stage?: string;
          ticketCode?: string | null;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setStage("gone");
          return;
        }
        setTicketCode(data.ticketCode ?? null);
        if (data.stage === "completed" || data.stage === "expired") {
          setStage("done");
          return;
        }
        setStage("form");
      } catch {
        if (!cancelled) setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (score == null) {
      setErr("Elegí una nota del 1 al 10.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolved: resolved === "yes" ? true : resolved === "no" ? false : null,
          score,
          comment: comment.trim() || null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setErr(
          data.error === "already_completed"
            ? "Esta encuesta ya fue enviada."
            : data.error === "expired"
              ? "Este link ya venció."
              : "No se pudo guardar. Probá de nuevo.",
        );
        return;
      }
      setStage("done");
    } catch {
      setErr("Error de red. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(165deg, #faf7f5 0%, #f0e6e8 45%, #e8dfe2 100%)",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        color: "#1e1b1b",
        padding: "32px 16px 48px",
      }}
    >
      <div style={{ maxWidth: 440, margin: "0 auto" }}>
        <p
          style={{
            fontSize: 13,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#4a0e1c",
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Kira · Wara
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>
          Tu opinión
        </h1>
        <p style={{ margin: "0 0 24px", color: "#5c5656", fontSize: 15, lineHeight: 1.45 }}>
          {ticketCode
            ? `Consulta ${ticketCode}. Tres preguntas rápidas — no hace falta volver al chat.`
            : "Tres preguntas rápidas — no hace falta volver al chat."}
        </p>

        {stage === "loading" && (
          <p style={{ color: "#5c5656" }}>Cargando…</p>
        )}

        {stage === "gone" && (
          <p style={{ color: "#5c5656" }}>
            Este link no es válido o ya no está disponible.
          </p>
        )}

        {stage === "error" && (
          <p style={{ color: "#8b1e2d" }}>No pudimos cargar la encuesta.</p>
        )}

        {stage === "done" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 20,
              border: "1px solid #e5d5d8",
            }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>Gracias, lo tenemos.</p>
            <p style={{ margin: "8px 0 0", color: "#5c5656", fontSize: 14 }}>
              Ya podés cerrar esta página.
            </p>
          </div>
        )}

        {stage === "form" && (
          <form
            onSubmit={onSubmit}
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 20,
              border: "1px solid #e5d5d8",
              display: "grid",
              gap: 20,
            }}
          >
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: 10, fontSize: 15 }}>
                ¿Kira pudo resolver tu consulta?
              </legend>
              <div style={{ display: "flex", gap: 10 }}>
                {(
                  [
                    ["yes", "Sí"],
                    ["no", "No"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setResolved(value)}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border:
                        resolved === value
                          ? "2px solid #4a0e1c"
                          : "1px solid #d4c4c8",
                      background: resolved === value ? "#4a0e1c" : "#fff",
                      color: resolved === value ? "#fff" : "#1e1b1b",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: 10, fontSize: 15 }}>
                Del 1 al 10, ¿cómo valorás la atención de Kira?
              </legend>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 8,
                }}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setScore(n)}
                    style={{
                      padding: "10px 0",
                      borderRadius: 8,
                      border:
                        score === n ? "2px solid #4a0e1c" : "1px solid #d4c4c8",
                      background: score === n ? "#4a0e1c" : "#fff",
                      color: score === n ? "#fff" : "#1e1b1b",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>

            <label style={{ display: "grid", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                Comentario (opcional)
              </span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={800}
                placeholder="Qué sumarías o qué falló…"
                style={{
                  borderRadius: 8,
                  border: "1px solid #d4c4c8",
                  padding: 12,
                  fontSize: 15,
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </label>

            {err && (
              <p style={{ margin: 0, color: "#8b1e2d", fontSize: 14 }}>{err}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                border: 0,
                background: "#4a0e1c",
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Enviando…" : "Enviar"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
