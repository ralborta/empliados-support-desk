"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { priorityLabels } from "@/lib/tickets";
import { priorityBadgeClass } from "@/lib/ui/badges";

type NotificationItem = {
  id: string;
  type: string;
  readAt: string | null;
  createdAt: string;
  ticket: {
    id: string;
    code: string;
    title: string;
    priority: string;
    status: string;
    customer: { companyName: string | null; name: string | null };
  };
};

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.unreadCount ?? 0);
      setItems(data.notifications ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 45000);
    return () => clearInterval(id);
  }, [load]);

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
    if (!n.readAt) {
      await fetch(`/api/notifications/${n.id}`, { method: "PATCH" });
    }
    setOpen(false);
    router.push(`/tickets/${n.ticket.id}`);
  }

  return (
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
  );
}
