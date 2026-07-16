"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Ticket,
  Users,
  Settings,
  UserCircle,
  LogOut,
  Circle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { AgentAvatar } from "@/components/ui/AgentAvatar";

type SessionUser = {
  name: string;
  email: string;
  role: string;
};

type NavCounts = {
  status: Record<string, number>;
  priority: Record<string, number>;
};

export function TicketsLayout({
  children,
  headerSubtitle,
  urgentCount,
  showHeader = true,
}: {
  children: React.ReactNode;
  headerSubtitle?: string;
  urgentCount?: number;
  showHeader?: boolean;
}) {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setUser(d?.user ?? null))
      .catch(() => setUser(null));
  }, []);

  return (
    <div className="flex min-h-screen bg-[#f4f5f7]">
      <TicketsSidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto p-5 lg:p-6">
          {showHeader ? (
            <PageHeader
              userName={user?.name || user?.email}
              urgentCount={urgentCount}
              subtitle={headerSubtitle}
            />
          ) : (
            <div className="mb-5 flex justify-end">
              <NotificationBell />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function TicketsSidebar({ user }: { user: SessionUser | null }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    fetch("/api/nav/counts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCounts(d))
      .catch(() => setCounts(null));
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
    } catch {
      setLoggingOut(false);
    }
  }

  const s = counts?.status ?? {};
  const p = counts?.priority ?? {};
  const roleLabel = user?.role === "ADMIN" ? "Administrador" : "Asesor";

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-[#4a0e1c] text-white lg:w-72">
      <div className="border-b border-white/10 px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-90">
          <Image
            src="/wara-logo.png"
            alt="Wara"
            width={120}
            height={48}
            priority
            className="h-10 w-auto object-contain"
          />
          <div>
            <span className="block text-sm font-semibold">Soporte</span>
            <span className="text-[11px] text-white/60">Mesa operativa</span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4 text-sm">
        <SectionTitle>Inicio</SectionTitle>
        <NavLink href="/dashboard" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
        <NavLink href="/tickets" icon={<Ticket className="h-4 w-4" />} label="Todos los Tickets" />

        <SectionTitle>Por Estado</SectionTitle>
        <NavLink href="/tickets/abiertos" label="Abiertos" count={s.OPEN} />
        <NavLink href="/tickets/en-progreso" label="En Progreso" count={s.IN_PROGRESS} />
        <NavLink href="/tickets/esperando-cliente" label="Esperando cliente" count={s.WAITING_CUSTOMER} />
        <NavLink href="/tickets/resueltos" label="Resueltos" count={s.RESOLVED} />
        <NavLink href="/tickets/cerrados" label="Cerrados" count={s.CLOSED} />

        <SectionTitle>Por Prioridad</SectionTitle>
        <NavLink href="/tickets/urgentes" label="Urgente" dot="text-red-400" count={p.URGENT} />
        <NavLink href="/tickets/alta" label="Alta" dot="text-orange-400" count={p.HIGH} />
        <NavLink href="/tickets/normal" label="Normal" dot="text-emerald-400" count={p.NORMAL} />
        <NavLink href="/tickets/baja" label="Baja" dot="text-slate-400" count={p.LOW} />

        <SectionTitle>Gestión</SectionTitle>
        {isAdmin ? (
          <>
            <NavLink href="/agentes" icon={<Users className="h-4 w-4" />} label="Agentes" />
            <NavLink href="/configuracion" icon={<Settings className="h-4 w-4" />} label="Configuración" />
          </>
        ) : null}
        <NavLink href="/clientes" icon={<UserCircle className="h-4 w-4" />} label="Clientes" />
      </nav>

      <div className="border-t border-white/10 px-3 py-4">
        {user ? (
          <div className="mb-3 flex items-center gap-3 rounded-lg px-2 py-2">
            <AgentAvatar name={user.name || user.email} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user.name || user.email}</p>
              <p className="truncate text-[11px] text-white/50">{roleLabel}</p>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
        </button>
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-widest text-white/40 first:pt-0">
      {children}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  dot,
  count,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  dot?: string;
  count?: number;
}) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-white text-[#4a0e1c] shadow-sm"
          : "text-white/75 hover:bg-white/10 hover:text-white"
      }`}
    >
      {dot ? (
        <Circle className={`h-2 w-2 shrink-0 fill-current ${dot}`} strokeWidth={0} />
      ) : icon ? (
        icon
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 ? (
        <span
          className={`shrink-0 text-xs tabular-nums ${active ? "text-[#4a0e1c]/55" : "text-white/45"}`}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}
