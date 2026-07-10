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

type SessionUser = {
  name: string;
  email: string;
  role: string;
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
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

function TicketsSidebar({ user }: { user: SessionUser | null }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const isAdmin = user?.role === "ADMIN";

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
    } catch {
      setLoggingOut(false);
    }
  }

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
        <NavLink href="/tickets/abiertos" label="Abiertos" />
        <NavLink href="/tickets/en-progreso" label="En Progreso" />
        <NavLink href="/tickets/esperando-cliente" label="Esperando cliente" />
        <NavLink href="/tickets/resueltos" label="Resueltos" />
        <NavLink href="/tickets/cerrados" label="Cerrados" />

        <SectionTitle>Por Prioridad</SectionTitle>
        <NavLink href="/tickets/urgentes" label="Urgente" dot="text-red-400" />
        <NavLink href="/tickets/alta" label="Alta" dot="text-orange-400" />
        <NavLink href="/tickets/normal" label="Normal" dot="text-emerald-400" />
        <NavLink href="/tickets/baja" label="Baja" dot="text-slate-400" />

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
          <p className="mb-2 truncate px-3 text-xs text-white/60" title={user.email}>
            {user.name || user.email}
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
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
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  dot?: string;
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
        <Circle className={`h-2 w-2 fill-current ${dot}`} strokeWidth={0} />
      ) : icon ? (
        icon
      ) : (
        <span className="w-4" />
      )}
      {label}
    </Link>
  );
}
