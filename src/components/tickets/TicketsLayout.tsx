"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function TicketsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <TicketsSidebar />
      <main className="flex-1 bg-rose-50/60 p-6">{children}</main>
    </div>
  );
}

function TicketsSidebar() {
  return (
    <aside className="w-72 bg-gradient-to-b from-rose-950 via-rose-900 to-rose-950 text-white shadow-2xl border-r border-rose-800/50">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-700/50">
        <Link href="/tickets" className="flex items-center gap-3 hover:opacity-90 transition">
          <Image src="/wara-logo.png" alt="Soporte" width={120} height={48} priority />
          <div>
            <span className="text-lg font-bold block">Soporte</span>
            <span className="text-xs text-rose-200">Mesa operativa</span>
          </div>
        </Link>
      </div>
      <nav className="space-y-1 px-3 py-4 text-sm overflow-y-auto h-[calc(100vh-100px)]">
        <SectionTitle>Inicio</SectionTitle>
        <NavLink label="📊 Dashboard" href="/dashboard" />
        <NavLink label="🎫 Todos los Tickets" href="/tickets" />
        <SectionTitle>Por Estado</SectionTitle>
        <NavLink label="Abiertos" href="/tickets/abiertos" />
        <NavLink label="En Progreso" href="/tickets/en-progreso" />
        <NavLink label="Esperando datos del cliente" href="/tickets/esperando-cliente" />
        <NavLink label="Resueltos" href="/tickets/resueltos" />
        <NavLink label="Cerrados" href="/tickets/cerrados" />
        <SectionTitle>Por Prioridad</SectionTitle>
        <NavLink label="Urgente" href="/tickets/urgentes" indicator="bg-rose-500" />
        <NavLink label="Alta" href="/tickets/alta" indicator="bg-amber-500" />
        <NavLink label="Normal" href="/tickets/normal" indicator="bg-emerald-500" />
        <NavLink label="Baja" href="/tickets/baja" indicator="bg-slate-400" />
        <SectionTitle>Gestión</SectionTitle>
        <NavLink label="👥 Agentes" href="/agentes" />
        <NavLink label="⚙️ Configuración" href="/configuracion" />
        <NavLink label="👤 Clientes" href="/clientes" />
      </nav>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-2 pt-5 text-xs font-bold uppercase tracking-wider text-slate-400 border-t border-slate-700/50 mt-2">
      {children}
    </div>
  );
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
      className={`group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
        active
          ? "bg-white text-slate-900 shadow-lg"
          : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {indicator ? (
        <span className={`h-2.5 w-2.5 rounded-full ${indicator} shadow-sm`}></span>
      ) : (
        <span className="w-2.5"></span>
      )}
      <span>{label}</span>
      {active && (
        <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-slate-900"></span>
      )}
    </Link>
  );
}
