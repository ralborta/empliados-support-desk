"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";

export type FeedbackRow = {
  id: string;
  at: string;
  ticketId: string;
  ticketCode: string;
  cliente: string | null;
  score: number | null;
  comment: string | null;
  stage: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function scoreTone(score: number | null): string {
  if (score == null) return "bg-slate-100 text-slate-600";
  if (score >= 8) return "bg-emerald-50 text-emerald-800";
  if (score >= 5) return "bg-amber-50 text-amber-900";
  return "bg-rose-50 text-rose-800";
}

export function FeedbackList({
  initialRows,
  initialAvg,
  initialCount,
}: {
  initialRows: FeedbackRow[];
  initialAvg: number | null;
  initialCount: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [avg, setAvg] = useState(initialAvg);
  const [count, setCount] = useState(initialCount);
  const [from, setFrom] = useState(daysAgoIsoDate(30));
  const [to, setTo] = useState(todayIsoDate());
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const queryString = useCallback(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (minScore) params.set("minScore", minScore);
    if (maxScore) params.set("maxScore", maxScore);
    if (q.trim()) params.set("q", q.trim());
    return params.toString();
  }, [from, to, minScore, maxScore, q]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/feedback?${queryString()}`);
      const data = (await res.json()) as {
        data?: FeedbackRow[];
        meta?: { avgScore?: number | null; countWithScore?: number };
      };
      setRows(data.data ?? []);
      setAvg(data.meta?.avgScore ?? null);
      setCount(data.meta?.countWithScore ?? 0);
    } catch {
      // silently keep previous
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Respuestas con nota
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{count}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Promedio
          </p>
          <p className="mt-1 text-2xl font-bold text-[#4a0e1c]">
            {avg != null ? avg.toFixed(1) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            En listado
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="text-xs text-slate-600">
            Desde
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Hasta
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Nota mín.
            <select
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Nota máx.
            <select
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[12rem] flex-1 text-xs text-slate-600">
            Buscar
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cliente, ticket, comentario…"
              className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#4a0e1c] px-3 py-2 text-xs font-semibold text-white hover:bg-[#5c1224] disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" />
              {loading ? "…" : "Filtrar"}
            </button>
            <a
              href={`/api/feedback?${queryString()}&format=csv`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </a>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Fecha</th>
                <th className="px-4 py-2.5 font-medium">Ticket</th>
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 font-medium">Nota</th>
                <th className="px-4 py-2.5 font-medium">Comentario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Todavía no hay respuestas en este rango.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                      {new Date(r.at).toLocaleString("es-AR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/tickets/${r.ticketId}`}
                        className="font-medium text-[#4a0e1c] hover:underline"
                      >
                        {r.ticketCode}
                      </Link>
                    </td>
                    <td className="max-w-[14rem] truncate px-4 py-2.5 text-slate-800">
                      {r.cliente ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex min-w-[2rem] justify-center rounded-md px-2 py-0.5 text-xs font-bold ${scoreTone(r.score)}`}
                      >
                        {r.score ?? "—"}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-2.5 text-slate-700">
                      {r.comment ? (
                        <span className="line-clamp-2">{r.comment}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
