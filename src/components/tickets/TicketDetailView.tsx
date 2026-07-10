"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, User } from "lucide-react";
import { statusLabels, priorityLabels, fromLabels, categoryLabels } from "@/lib/tickets";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/ui/badges";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { MessageComposer } from "@/components/tickets/MessageComposer";
import { StatusActions } from "@/components/tickets/StatusActions";
import { ConversationSummary } from "@/components/tickets/ConversationSummary";
import { AssignAgentDropdown } from "@/components/tickets/AssignAgentDropdown";
import { MessageAttachments } from "@/components/tickets/MessageAttachments";
import { QuickActionsPanel } from "@/components/tickets/QuickActionsPanel";
import { resolutionModeLabels, waraIncidentLabels, type WaraIncidentType } from "@/lib/wara";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";

interface TicketDetailViewProps {
  ticket: {
    id: string;
    code: string;
    title: string;
    status: string;
    priority: string;
    category: string;
    resolution: string | null;
    incidentType: string | null;
    contactName: string;
    createdAt: string;
    lastMessageAt: string;
    aiSummary: string | null;
    assignedToUserId: string | null;
    customerId: string | null;
    customer: {
      name: string | null;
      companyName: string | null;
      licensePlate: string | null;
      phone: string;
      botPausedAt: Date | null;
    } | null;
    assignedTo: { name: string } | null;
    messages: Array<{
      id: string;
      from: string;
      text: string;
      createdAt: string;
      attachments: unknown;
      rawPayload?: unknown;
    }>;
  };
  agentes: Array<{ id: string; name: string; email: string }>;
  wara: Record<string, unknown> | null;
  incidentTypeLabel: string;
  formatDateTimeAR: (value: string) => string;
}

export function TicketDetailView({
  ticket,
  agentes,
  wara,
  incidentTypeLabel,
  formatDateTimeAR,
}: TicketDetailViewProps) {
  const [tab, setTab] = useState<"conversacion" | "detalles" | "historial">("conversacion");
  const conversation = ticket.messages || [];

  const tabs = [
    { id: "conversacion" as const, label: "Conversación" },
    { id: "detalles" as const, label: "Detalles" },
    { id: "historial" as const, label: "Historial" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/tickets"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a la lista
          </Link>
          <h1 className="text-xl font-bold text-slate-900">{ticket.title}</h1>
          <p className="text-sm text-slate-500">{ticket.code}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusActions ticketId={ticket.id} currentStatus={ticket.status as TicketStatus} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-5">
        <MetaItem label="Cliente" value={ticket.customer?.companyName?.trim() || ticket.contactName} />
        <MetaItem label="Estado">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusBadgeClass(ticket.status as TicketStatus)}`}
          >
            {statusLabels[ticket.status as TicketStatus]}
          </span>
        </MetaItem>
        <MetaItem label="Prioridad">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${priorityBadgeClass(ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT")}`}
          >
            {priorityLabels[ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT"]}
          </span>
        </MetaItem>
        <MetaItem label="Asignado a">
          {ticket.assignedTo ? (
            <span className="flex items-center gap-2">
              <AgentAvatar name={ticket.assignedTo.name} size="sm" />
              {ticket.assignedTo.name}
            </span>
          ) : (
            "Sin asignar"
          )}
        </MetaItem>
        <MetaItem label="Creado" value={formatDateTimeAR(ticket.createdAt)} />
      </div>

      <div className="border-b border-slate-200">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.id
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "conversacion" ? (
        <div className="grid gap-5 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-8">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="max-h-[calc(100vh-380px)] overflow-y-auto p-4">
                <div className="space-y-4">
                  {conversation.length === 0 ? (
                    <p className="text-sm text-slate-500">Sin mensajes aún.</p>
                  ) : (
                    conversation.map((msg) => {
                      const fromLabel =
                        fromLabels[msg.from as "CUSTOMER" | "BOT" | "HUMAN"] || msg.from;
                      return (
                        <div key={msg.id} className="flex gap-3">
                          {msg.from === "BOT" ? (
                            <Image
                              src="/atilio-logo.png"
                              alt=""
                              width={32}
                              height={32}
                              className="h-8 w-8 shrink-0 rounded-full object-contain ring-1 ring-slate-200"
                            />
                          ) : msg.from === "CUSTOMER" ? (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                              <User className="h-4 w-4" />
                            </span>
                          ) : (
                            <AgentAvatar name={fromLabel} size="md" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-semibold text-slate-700">{fromLabel}</span>
                              <span>·</span>
                              <span>{formatDateTimeAR(msg.createdAt)}</span>
                            </div>
                            <div
                              className={`inline-block max-w-2xl rounded-2xl px-4 py-2.5 text-sm ${
                                msg.from === "CUSTOMER"
                                  ? "bg-slate-100 text-slate-800"
                                  : msg.from === "BOT"
                                    ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100"
                                    : "bg-violet-50 text-violet-900 ring-1 ring-violet-100"
                              }`}
                            >
                              {msg.text || "[Sin texto]"}
                            </div>
                            {msg.attachments ? (
                              <MessageAttachments attachments={msg.attachments as never} />
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <MessageComposer
              ticketId={ticket.id}
              customerId={ticket.customerId}
              botPaused={!!ticket.customer?.botPausedAt}
            />
          </div>

          <div className="space-y-4 xl:col-span-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <AssignAgentDropdown
                ticketId={ticket.id}
                currentAgentId={ticket.assignedToUserId}
                agentes={agentes}
              />
            </div>
            <ConversationSummary ticketId={ticket.id} initialSummary={ticket.aiSummary} />
            <QuickActionsPanel
              ticketId={ticket.id}
              currentPriority={ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT"}
              currentResolution={ticket.resolution}
            />
          </div>
        </div>
      ) : null}

      {tab === "detalles" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <DetailCard title="Datos operativos">
            <DetailRow label="Tipo de incidente" value={incidentTypeLabel} />
            <DetailRow
              label="Matrícula"
              value={ticket.customer?.licensePlate?.trim() || (wara?.plate as string) || "Sin informar"}
            />
            <DetailRow
              label="Razón social"
              value={
                ticket.customer?.companyName?.trim() ||
                ticket.customer?.name?.trim() ||
                "Sin informar"
              }
            />
            <DetailRow
              label="Modo resolución"
              value={
                ticket.resolution
                  ? (resolutionModeLabels as Record<string, string>)[ticket.resolution] ||
                    ticket.resolution
                  : "Sin definir"
              }
            />
            <DetailRow label="Categoría" value={categoryLabels[ticket.category as keyof typeof categoryLabels] || ticket.category} />
          </DetailCard>
          <DetailCard title="Contacto">
            <DetailRow label="Persona" value={ticket.customer?.name?.trim() || "—"} />
            <DetailRow label="Empresa" value={ticket.customer?.companyName?.trim() || "—"} />
            <DetailRow label="Contacto ticket" value={ticket.contactName} />
            <DetailRow label="Teléfono" value={ticket.customer?.phone || "—"} />
          </DetailCard>
        </div>
      ) : null}

      {tab === "historial" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-800">Línea de tiempo</p>
          <div className="space-y-3">
            <TimelineItem
              label="Ticket creado"
              date={formatDateTimeAR(ticket.createdAt)}
            />
            {conversation.slice(-5).map((msg) => (
              <TimelineItem
                key={msg.id}
                label={`Mensaje ${fromLabels[msg.from as "CUSTOMER" | "BOT" | "HUMAN"] || msg.from}`}
                date={formatDateTimeAR(msg.createdAt)}
                detail={msg.text?.slice(0, 80)}
              />
            ))}
            <TimelineItem
              label="Última actividad"
              date={formatDateTimeAR(ticket.lastMessageAt)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetaItem({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm font-medium text-slate-800">{children || value || "—"}</div>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

function TimelineItem({
  label,
  date,
  detail,
}: {
  label: string;
  date: string;
  detail?: string;
}) {
  return (
    <div className="flex gap-3 border-l-2 border-violet-200 pl-4">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">{date}</p>
        {detail ? <p className="mt-1 text-xs text-slate-600">{detail}…</p> : null}
      </div>
    </div>
  );
}
