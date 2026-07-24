"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { AgentAssignmentToastStack, type AssignmentToastItem } from "@/components/layout/AgentAssignmentToast";
import { priorityLabels } from "@/lib/tickets";
import { priorityBadgeClass } from "@/lib/ui/badges";

type NotificationItem = AssignmentToastItem & {
  readAt: string | null;
  createdAt: string;
  ticket: AssignmentToastItem["ticket"] & { status: string };
};

/** Alerta audible más marcada para el asesor dentro de la plataforma. */
function playAlertSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playTone = (freq: number, startAt: number, duration: number, volume = 0.55) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration);
    };
    const now = ctx.currentTime;
    playTone(880, now, 0.2, 0.62);
    playTone(1175, now + 0.14, 0.22, 0.68);
    playTone(1568, now + 0.32, 0.28, 0.72);
    setTimeout(() => ctx.close().catch(() => undefined), 900);
  } catch {
    /* Autoplay bloqueado u otro error: no rompe el flujo. */
  }
}

function notifyDesktopFallback(n: NotificationItem) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  const company = n.ticket.customer.companyName || n.ticket.customer.name || "Cliente";
  const title =
    n.type === "UNASSIGNED_ALERT"
      ? `Caso sin asesor: ${n.ticket.code}`
      : `Nuevo caso: ${n.ticket.code}`;
  try {
    const notif = new Notification(title, {
      body: `${company} — ${n.ticket.title}`,
      tag: n.id,
      icon: "/favicon.ico",
    });
    notif.onclick = () => {
      window.focus();
      window.location.href = `/tickets/${n.ticket.id}`;
    };
  } catch {
    /* ignore */
  }
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string> | null>(null);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (n: NotificationItem) => {
      setToasts((prev) => {
        if (prev.some((t) => t.id === n.id)) return prev;
        return [n, ...prev].slice(0, 4);
      });
      const timer = setTimeout(() => dismissToast(n.id), 12000);
      toastTimersRef.current.set(n.id, timer);
    },
    [dismissToast],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      const notifications: NotificationItem[] = data.notifications ?? [];
      setUnreadCount(data.unreadCount ?? 0);
      setItems(notifications);

      const unread = notifications.filter((n) => !n.readAt);
      if (seenIdsRef.current === null) {
        seenIdsRef.current = new Set(unread.map((n) => n.id));
      } else {
        const brandNew = unread.filter((n) => !seenIdsRef.current!.has(n.id));
        if (brandNew.length > 0) {
          playAlertSound();
          brandNew.forEach((n) => {
            pushToast(n);
            notifyDesktopFallback(n);
            seenIdsRef.current!.add(n.id);
          });
        }
      }
    } catch {
      /* ignore */
    }
  }, [pushToast]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timer) => clearTimeout(timer));
      toastTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function markAllRead() {
    setLoading(true);
    try {
      await fetch("/api/notifications", { method: "POST" });
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function openNotification(n: NotificationItem) {
    dismissToast(n.id);
    if (!n.readAt) {
      await fetch(`/api/notifications/${n.id}`, { method: "PATCH" });
    }
    setOpen(false);
    router.push(`/tickets/${n.ticket.id}`);
  }

  return (
    <>
      <AgentAssignmentToastStack items={toasts} onDismiss={dismissToast} />
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            if (!open) load();
          }}
          className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
          title="Mis notificaciones"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>

        {open ? (
          <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-semibold text-slate-800">Mis asignaciones</span>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={loading}
                  className="text-xs font-medium text-violet-600 hover:text-violet-800 disabled:opacity-50"
                >
                  Marcar leídas
                </button>
              ) : null}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Sin notificaciones</p>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openNotification(n)}
                    className={`block w-full border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${
                      n.readAt ? "opacity-70" : "bg-violet-50/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-violet-700">{n.ticket.code}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${priorityBadgeClass(n.ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT")}`}
                      >
                        {priorityLabels[n.ticket.priority as keyof typeof priorityLabels] ?? n.ticket.priority}
                      </span>
                    </div>
                    {n.type === "UNASSIGNED_ALERT" ? (
                      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                        Sin asesor conectado
                      </p>
                    ) : null}
                    <p className="mt-1 truncate text-sm font-medium text-slate-800">{n.ticket.title}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {n.ticket.customer.companyName || n.ticket.customer.name || "Cliente"}
                    </p>
                  </button>
                ))
              )}
            </div>
            <div className="border-t border-slate-100 px-4 py-2">
              <Link
                href="/tickets"
                className="text-xs font-medium text-violet-600 hover:text-violet-800"
                onClick={() => setOpen(false)}
              >
                Ver mis tickets →
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
