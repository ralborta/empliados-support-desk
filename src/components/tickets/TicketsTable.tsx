"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { statusLabels, priorityLabels } from "@/lib/tickets";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/ui/badges";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { formatRelativeTime, formatExactDateTime } from "@/lib/formatRelativeTime";
import { waraAccent } from "@/lib/ui/waraTheme";

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

  const navigate = (id: string) => router.push(`/tickets/${id}`);

  return (
    <div className={compact ? "" : "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"}>
      <div className="max-h-[calc(100vh-14rem)] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
            <tr>
              <th className="w-[72px] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                ID
              </th>
              <th className="min-w-[200px] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Asunto
              </th>
              <th className="hidden px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 md:table-cell">
                Cliente
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Estado
              </th>
              <th className="hidden px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:table-cell">
                Prioridad
              </th>
              <th className="hidden px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 lg:table-cell">
                Asignado
              </th>
              <th className="w-[100px] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Actividad
              </th>
              <th className="w-8 px-1 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  No hay tickets en esta sección.
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => {
                const relative = formatRelativeTime(ticket.lastMessageAt);
                const exact = formatExactDateTime(ticket.lastMessageAt);
                const customerLabel =
                  ticket.customer?.companyName?.trim() ||
                  ticket.customer?.name?.trim() ||
                  ticket.contactName;

                return (
                  <tr
                    key={ticket.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Ticket ${ticket.code}: ${ticket.title}`}
                    className={`cursor-pointer transition-colors ${waraAccent.rowHover}`}
                    onClick={() => navigate(ticket.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(ticket.id);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="font-mono text-[11px] text-slate-400">#{ticket.code}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className={`block text-sm font-semibold leading-snug text-slate-900 hover:text-[#4a0e1c] ${waraAccent.ring}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="line-clamp-2 md:line-clamp-1">{ticket.title}</span>
                        <span className="mt-0.5 block text-[11px] font-normal text-slate-500 md:hidden">
                          {customerLabel}
                        </span>
                      </Link>
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <div className="max-w-[160px] truncate text-sm text-slate-600">{customerLabel}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusBadgeClass(ticket.status as TicketStatus)}`}
                      >
                        {statusLabels[ticket.status as TicketStatus]}
                      </span>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${priorityBadgeClass(ticket.priority as TicketPriority)}`}
                      >
                        {priorityLabels[ticket.priority as TicketPriority]}
                      </span>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 lg:table-cell">
                      {ticket.assignedTo ? (
                        <div className="flex items-center gap-1.5">
                          <AgentAvatar name={ticket.assignedTo.name} size="sm" />
                          <span className="max-w-[88px] truncate text-xs text-slate-700">
                            {ticket.assignedTo.name.split(" ")[0]}
                          </span>
                        </div>
                      ) : (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${waraAccent.chipMuted}`}
                        >
                          Sin asignar
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className="text-xs font-medium text-slate-700"
                        title={exact}
                      >
                        {relative}
                      </span>
                    </td>
                    <td className="px-1 py-2 text-slate-300">
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </td>
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
