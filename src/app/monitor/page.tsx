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

type MonitorActivityMessage = {
  id: string;
  at: string;
  direction: "INBOUND" | "OUTBOUND";
  from: string;
  textPreview: string;
  ticketCode: string;
  ticketStatus: string;
  phone: string;
  contactName: string | null;
  companyName: string | null;
};

type MonitorActivitySummary = {
  windowMinutes: number;
  inboundCount: number;
  outboundCount: number;
  activePhones: number;
  lastInboundAt: string | null;
};

type WaraHealth = {
  healthy: boolean;
  stage: string;
  message: string;
  apiBaseUrl: string;
  isStagingUrl: boolean;
  configWarning?: string;
  checkedAt: string;
  httpStatus?: number;
};

type BbcHealth = {
  status: string;
  healthy: boolean;
  host: string | null;
  lastEventAt: string | null;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  restartCount: number;
  updatedAt: string;
  apiProbeOk?: boolean;
  apiProbeMessage?: string;
  apiProbeHttpStatus?: number;
};

type MonitorResponse = {
  ok: boolean;
  generatedAt?: string;
  agents?: MonitorAgent[];
  activity?: {
    summary: MonitorActivitySummary;
    messages: MonitorActivityMessage[];
  };
  wara?: WaraHealth;
  bbc?: BbcHealth;
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

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, -4)}…${digits.slice(-4)}`;
  }
  return phone;
}

function directionLabel(msg: MonitorActivityMessage): string {
  if (msg.direction === "INBOUND") return "Cliente";
  if (msg.from === "BOT") return "Bot";
  return "Panel";
}

function waraStageLabel(stage: string): string {
  switch (stage) {
    case "ok":
      return "Operativa";
    case "network_error":
      return "Sin conexión";
    case "token_invalid":
      return "Token inválido";
    case "misconfigured":
      return "Mal configurada";
    case "wrong_environment":
      return "Entorno incorrecto";
    default:
      return stage;
  }
}

type Tone = "ok" | "warn" | "bad" | "neutral";

function toneClasses(tone: Tone): { card: string; badge: string } {
  switch (tone) {
    case "ok":
      return {
        card: "border-emerald-800/60 bg-emerald-950/30",
        badge: "bg-emerald-500/20 text-emerald-200",
      };
    case "warn":
      return {
        card: "border-amber-700/60 bg-amber-950/40",
        badge: "bg-amber-500/20 text-amber-200",
      };
    case "bad":
      return {
        card: "border-red-800/70 bg-red-950/40",
        badge: "bg-red-500/20 text-red-200",
      };
    default:
      return {
        card: "border-slate-800 bg-slate-900/50",
        badge: "bg-slate-500/20 text-slate-300",
      };
  }
}

function StatusCard(props: {
  title: string;
  badge: string;
  tone: Tone;
  lines: string[];
  footnote?: string;
}) {
  const c = toneClasses(props.tone);
  return (
    <section className={`rounded-xl border px-4 py-4 ${c.card}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          {props.title}
        </h2>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${c.badge}`}>
          {props.badge}
        </span>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-slate-300">
        {props.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {props.footnote ? (
        <p className="mt-3 font-mono text-[11px] text-slate-500">{props.footnote}</p>
      ) : null}
    </section>
  );
}

export default function MonitorPage() {
  const [password, setPassword] = useState<string>("");
  const [unlocked, setUnlocked] = useState(false);
  const [agents, setAgents] = useState<MonitorAgent[]>([]);
  const [activity, setActivity] = useState<MonitorResponse["activity"]>(undefined);
  const [wara, setWara] = useState<WaraHealth | null>(null);
  const [bbc, setBbc] = useState<BbcHealth | null>(null);
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
      setActivity(data.activity);
      setWara(data.wara ?? null);
      setBbc(data.bbc ?? null);
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
          <h1 className="mb-1 text-lg font-semibold text-slate-100">Monitor de operaciones</h1>
          <p className="mb-6 text-sm text-slate-400">
            Vista externa (EasyPanel): estados BBC, API Wara, presencia y actividad WhatsApp.
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
  const summary = activity?.summary;
  const recentMessages = activity?.messages ?? [];
  const windowHours = summary ? Math.round(summary.windowMinutes / 60) : 3;

  const bbcOk = Boolean(bbc?.healthy && bbc.apiProbeOk !== false);
  const bbcTone: Tone = !bbc ? "neutral" : bbcOk ? "ok" : "bad";
  const waraTone: Tone = !wara
    ? "neutral"
    : !wara.healthy
      ? "bad"
      : wara.configWarning
        ? "warn"
        : "ok";
  const teamTone: Tone = onlineCount > 0 ? "ok" : "warn";

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Monitor de operaciones</h1>
            <p className="text-sm text-slate-400">
              BBC WhatsApp · API Wara · presencia · actividad
              {generatedAt ? ` · actualizado ${formatDateTime(generatedAt)}` : ""}
              {loading ? " · refrescando…" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchStatus(password)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Actualizar
            </button>
            <button
              type="button"
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
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <StatusCard
            title="BBC / WhatsApp"
            badge={bbc ? (bbcOk ? "ONLINE" : bbc.status || "OFFLINE") : "Sin datos"}
            tone={bbcTone}
            lines={
              bbc
                ? [
                    `Runtime: ${bbc.status}${bbc.host ? ` · ${bbc.host}` : ""}`,
                    bbc.apiProbeMessage || "Sonda API pendiente",
                    `Reinicios detectados: ${bbc.restartCount}`,
                    bbc.lastOnlineAt
                      ? `Último ONLINE: ${formatDateTime(bbc.lastOnlineAt)}`
                      : "Aún no hubo evento status.ready",
                  ]
                : ["Esperando primer chequeo…"]
            }
            footnote={bbc ? `actualizado ${formatDateTime(bbc.updatedAt)}` : undefined}
          />

          <StatusCard
            title="API Wara"
            badge={
              wara
                ? wara.healthy
                  ? wara.configWarning
                    ? "Advertencia"
                    : "OK"
                  : waraStageLabel(wara.stage)
                : "Sin datos"
            }
            tone={waraTone}
            lines={
              wara
                ? [
                    wara.message,
                    !wara.healthy
                      ? "El bot puede seguir en WhatsApp, pero sin datos de flota."
                      : "Consultas de unidades / empresas responden.",
                  ]
                : ["Esperando primer chequeo…"]
            }
            footnote={wara ? wara.apiBaseUrl : undefined}
          />

          <StatusCard
            title="Equipo en panel"
            badge={`${onlineCount}/${agents.length} online`}
            tone={teamTone}
            lines={[
              onlineCount > 0
                ? "Hay asesores/admins conectados para tomar casos."
                : "Nadie conectado: los casos nuevos pueden quedar sin asignar.",
              `Timeout de presencia: refresco cada ${REFRESH_MS / 1000}s`,
            ]}
          />
        </div>

        {summary && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Mensajes cliente</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-400">{summary.inboundCount}</p>
              <p className="text-xs text-slate-500">últimas {windowHours} h</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Respuestas bot</p>
              <p className="mt-1 text-2xl font-semibold text-sky-400">{summary.outboundCount}</p>
              <p className="text-xs text-slate-500">últimas {windowHours} h</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Teléfonos activos</p>
              <p className="mt-1 text-2xl font-semibold text-amber-300">{summary.activePhones}</p>
              <p className="text-xs text-slate-500">con mensaje entrante</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Último mensaje cliente</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">
                {summary.lastInboundAt ? formatElapsed(summary.lastInboundAt) : "—"}
              </p>
              <p className="text-xs text-slate-500">
                {summary.lastInboundAt ? formatDateTime(summary.lastInboundAt) : "sin actividad"}
              </p>
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
            Actividad WhatsApp reciente
          </h2>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Hora</th>
                  <th className="px-4 py-3">Quién</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Mensaje</th>
                  <th className="px-4 py-3">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {recentMessages.map((msg) => (
                  <tr key={msg.id} className="bg-slate-900/20 hover:bg-slate-900/40">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400" title={formatDateTime(msg.at)}>
                      {formatElapsed(msg.at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-100">
                        {msg.contactName ?? formatPhone(msg.phone)}
                      </div>
                      <div className="text-xs text-slate-500">{formatPhone(msg.phone)}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{msg.companyName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                          msg.direction === "INBOUND"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-sky-500/15 text-sky-300"
                        }`}
                      >
                        {directionLabel(msg)}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-3 text-slate-300">{msg.textPreview}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-400">
                      {msg.ticketCode}
                    </td>
                  </tr>
                ))}
                {recentMessages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Sin mensajes en las últimas {windowHours} horas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-400">
            Presencia del equipo ({onlineCount} de {agents.length} conectados)
          </h2>
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
        </section>
      </div>
    </div>
  );
}
