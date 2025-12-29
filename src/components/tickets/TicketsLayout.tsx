"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TicketsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <TicketsSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

function TicketsSidebar() {
  return (
    <aside className="w-64 bg-slate-800 text-white shadow-lg">
      <div className="flex items-center gap-3 px-6 py-5 text-lg font-semibold">
        <Link href="/tickets" className="flex items-center gap-3 hover:opacity-80 transition">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
            🎧
          </span>
          <span>Soporte</span>
        </Link>
      </div>
      <nav className="space-y-1 px-2 pb-6 text-sm">
        <SectionTitle>Inicio</SectionTitle>
        <NavLink label="📊 Dashboard" href="/dashboard" />
        <NavLink label="🎫 Todos los Tickets" href="/tickets" />
        <SectionTitle>Por Estado</SectionTitle>
        <NavLink label="Abiertos" href="/tickets/abiertos" />
        <NavLink label="En Progreso" href="/tickets/en-progreso" />
        <NavLink label="Esperando Cliente" href="/tickets/esperando-cliente" />
        <NavLink label="Resueltos" href="/tickets/resueltos" />
        <NavLink label="Cerrados" href="/tickets/cerrados" />
        <SectionTitle>Por Prioridad</SectionTitle>
        <NavLink label="Urgente" href="/tickets/urgentes" indicator="bg-rose-500" />
        <NavLink label="Alta" href="/tickets/alta" indicator="bg-amber-500" />
        <NavLink label="Normal" href="/tickets/normal" indicator="bg-emerald-500" />
        <NavLink label="Baja" href="/tickets/baja" indicator="bg-slate-400" />
        <SectionTitle>Gestión</SectionTitle>
        <NavLink label="👥 Agentes" href="/agentes" />
      </nav>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-2 pt-4 text-xs uppercase text-slate-400">{children}</div>;
}

function NavLink({
  href,
  label,
  indicator,
}: {
  href: string;
  label: string;
  indicator?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={`group flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition hover:bg-white/10 ${
        active ? "bg-white/10 text-white" : "text-slate-200"
      }`}
    >
      {indicator ? <span className={`h-2 w-2 rounded-full ${indicator}`}></span> : null}
      <span>{label}</span>
    </Link>
  );
}
