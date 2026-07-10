"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { statusLabels, priorityLabels } from "@/lib/tickets";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/ui/badges";
import { AgentAvatar } from "@/components/ui/AgentAvatar";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

interface Ticket {
  id: string;
  code: string;
  title: string;
  contactName: string;
  status: string;
  priority: string;
  lastMessageAt: Date | string;
  createdAt: Date | string;
  customer?: {
    name: string | null;
    companyName: string | null;
    licensePlate: string | null;
    phone: string;
  } | null;
  assignedTo?: {
    name: string;
  } | null;
}

export function TicketsTable({
  tickets,
  compact = false,
}: {
  tickets: Ticket[];
  compact?: boolean;
}) {
  const router = useRouter();

  const formatDateTime = (date: Date | string) => {
    try {
      const d = typeof date === "string" ? new Date(date) : date;
      if (isNaN(d.getTime())) return { date: "N/A", time: "" };
      return {
        date: d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }),
        time: d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      };
    } catch {
      return { date: "N/A", time: "" };
    }
  };

  return (
    <div className={compact ? "" : "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/80">
            <tr>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                ID
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Asunto
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Cliente
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Estado
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Prioridad
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Asignado
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Última Actividad
              </th>
              {!compact ? (
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Creado
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 bg-white">
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={compact ? 7 : 8} className="px-4 py-10 text-center text-sm text-slate-500">
                  No hay tickets en esta sección.
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => {
                const lastActivity = formatDateTime(ticket.lastMessageAt);
                const created = formatDateTime(ticket.createdAt);
                return (
                  <tr
                    key={ticket.id}
                    className="cursor-pointer transition-colors hover:bg-violet-50/30"
                    onClick={() => router.push(`/tickets/${ticket.id}`)}
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-sm font-semibold text-slate-800">{ticket.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="text-sm font-medium text-slate-900 hover:text-violet-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ticket.title.length > 50 ? `${ticket.title.substring(0, 50)}…` : ticket.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-800">
                        {ticket.customer?.companyName?.trim() ||
                          ticket.customer?.name?.trim() ||
                          ticket.contactName}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${statusBadgeClass(ticket.status as TicketStatus)}`}
                      >
                        {statusLabels[ticket.status as TicketStatus]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${priorityBadgeClass(ticket.priority as TicketPriority)}`}
                      >
                        {priorityLabels[ticket.priority as TicketPriority]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {ticket.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <AgentAvatar name={ticket.assignedTo.name} size="sm" />
                          <span className="text-sm text-slate-700">{ticket.assignedTo.name.split(" ")[0]}</span>
                        </div>
                      ) : (
                        <span className="text-sm italic text-slate-400">Sin asignar</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="text-sm text-slate-700">{lastActivity.date}</div>
                      {lastActivity.time ? (
                        <div className="text-[11px] text-slate-400">{lastActivity.time}</div>
                      ) : null}
                    </td>
                    {!compact ? (
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="text-sm text-slate-600">{created.date}</div>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
