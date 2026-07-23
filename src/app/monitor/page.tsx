"use client";

import { useCallback, useEffect, useState } from "react";

type MonitorAgent = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "SUPPORT";
  online: boolean;
  connectedSince: string | null;
  lastSeenAt: string | null;
  currentPage: string | null;
  currentPageLabel: string;
};

type MonitorResponse = {
  ok: boolean;
  generatedAt?: string;
  agents?: MonitorAgent[];
  error?: string;
};

const STORAGE_KEY = "monitor_access_password";
const REFRESH_MS = 10_000;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function formatElapsed(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "hace instantes";
  if (totalMinutes < 60) return `hace ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `hace ${hours} h ${minutes} min`;
}

export default function MonitorPage() {
  const [password, setPassword] = useState<string>("");
  const [unlocked, setUnlocked] = useState(false);
  const [agents, setAgents] = useState<MonitorAgent[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setPassword(saved);
      setUnlocked(true);
    }
  }, []);

  const fetchStatus = useCallback(async (pwd: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/monitor/status", {
        headers: { "x-monitor-password": pwd },
        cache: "no-store",
      });
      const data: MonitorResponse = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Contraseña incorrecta");
        setUnlocked(false);
        window.sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      setError(null);
      setUnlocked(true);
      setAgents(data.agents ?? []);
      setGeneratedAt(data.generatedAt ?? null);
      window.sessionStorage.setItem(STORAGE_KEY, pwd);
    } catch {
      setError("No se pudo conectar. Reintentando...");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked || !password) return;
    void fetchStatus(password);
    const id = window.setInterval(() => void fetchStatus(password), REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, password]);

  if (!unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void fetchStatus(password);
          }}
          className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl"
        >
          <h1 className="mb-1 text-lg font-semibold text-slate-100">Monitor de presencia</h1>
          <p className="mb-6 text-sm text-slate-400">
            Vista externa de solo lectura. Ingresá la contraseña de acceso.
          </p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
          />
          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {loading ? "Verificando..." : "Entrar"}
          </button>
        </form>
      </div>
    );
  }

  const onlineCount = agents.filter((a) => a.online).length;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Monitor de presencia — Panel</h1>
            <p className="text-sm text-slate-400">
              {onlineCount} de {agents.length} conectados ahora
              {generatedAt ? ` · actualizado ${formatDateTime(generatedAt)}` : ""}
            </p>
          </div>
          <button
            onClick={() => {
              window.sessionStorage.removeItem(STORAGE_KEY);
              setUnlocked(false);
              setPassword("");
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            Salir
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Conectado desde</th>
                <th className="px-4 py-3">Última actividad</th>
                <th className="px-4 py-3">Pantalla</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {agents.map((agent) => (
                <tr key={agent.id} className={agent.online ? "bg-slate-900/40" : "bg-transparent"}>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        agent.online ? "bg-emerald-500" : "bg-slate-600"
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">{agent.name}</div>
                    <div className="text-xs text-slate-500">{agent.email}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {agent.role === "ADMIN" ? "Administrador" : "Soporte"}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {agent.online ? (
                      <span title={formatDateTime(agent.connectedSince)}>
                        {formatElapsed(agent.connectedSince)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{formatDateTime(agent.lastSeenAt)}</td>
                  <td className="px-4 py-3 text-slate-300">{agent.currentPageLabel}</td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No hay agentes registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
