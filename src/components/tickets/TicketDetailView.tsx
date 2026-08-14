"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { statusLabels, priorityLabels, fromLabels, categoryLabels } from "@/lib/tickets";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/ui/badges";
import { AgentAvatar } from "@/components/ui/AgentAvatar";
import { MessageComposer } from "@/components/tickets/MessageComposer";
import { ConversationSummary } from "@/components/tickets/ConversationSummary";
import { AssignAgentDropdown } from "@/components/tickets/AssignAgentDropdown";
import { MessageAttachments } from "@/components/tickets/MessageAttachments";
import { QuickActionsPanel } from "@/components/tickets/QuickActionsPanel";
import { V2OperationPanel } from "@/components/tickets/V2OperationPanel";
import { TicketPriorityPanel } from "@/components/tickets/TicketPriorityPanel";
import { TicketV2HeaderBadges } from "@/components/tickets/TicketV2HeaderBadges";
import { ConversationThread, type ThreadMessage } from "@/components/tickets/ConversationThread";
import { resolutionModeLabels } from "@/lib/wara";
import { formatDateTimeAR } from "@/lib/formatDateTimeAR";
import { usePollWhenVisible } from "@/lib/hooks/usePollWhenVisible";
import { waraAccent } from "@/lib/ui/waraTheme";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TabId = "conversacion" | "archivos" | "detalles" | "historial";

type Attachment = { url: string; type: string; name: string };

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
    botPaused?: boolean;
    customer: {
      name: string | null;
      companyName: string | null;
      licensePlate: string | null;
      phone: string;
    } | null;
    assignedTo: { name: string } | null;
    messages: Array<{
      id: string;
      from: string;
      text: string;
      createdAt: string;
      direction?: string;
      attachments: unknown;
    }>;
  };
  agentes: Array<{ id: string; name: string; email: string }>;
  wara: Record<string, unknown> | null;
  incidentTypeLabel: string;
  isAdmin?: boolean;
  labMode?: boolean;
}

function collectAttachments(
  messages: TicketDetailViewProps["ticket"]["messages"],
): Array<Attachment & { messageId: string; messageDate: string; from: string }> {
  const items: Array<Attachment & { messageId: string; messageDate: string; from: string }> = [];
  for (const msg of messages) {
    const atts = msg.attachments as Attachment[] | null;
    if (!atts || !Array.isArray(atts)) continue;
    for (const att of atts) {
      items.push({
        ...att,
        messageId: msg.id,
        messageDate: msg.createdAt,
        from: msg.from,
      });
    }
  }
  return items;
}

export function TicketDetailView({
  ticket,
  agentes,
  wara,
  incidentTypeLabel,
  isAdmin = false,
  labMode = false,
}: TicketDetailViewProps) {
  const [tab, setTab] = useState<TabId>("conversacion");
  const [conversation, setConversation] = useState<ThreadMessage[]>(
    (ticket.messages || []).map((m) => ({
      ...m,
      direction: m.direction,
    })),
  );
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const refreshMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        setConversation(data.messages);
      }
    } catch {
      /* ignore */
    }
  }, [ticket.id]);

  usePollWhenVisible(refreshMessages, 5000, tab === "conversacion");

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversation.length, tab]);

  const attachments = useMemo(() => collectAttachments(conversation), [conversation]);

  const companyName =
    ticket.customer?.companyName?.trim() ||
    ticket.customer?.name?.trim() ||
    ticket.contactName;
  const plate =
    ticket.customer?.licensePlate?.trim() || (wara?.plate as string | undefined) || undefined;

  const tabs: { id: TabId; label: string }[] = [
    { id: "conversacion", label: "Conversación" },
    { id: "archivos", label: attachments.length > 0 ? `Archivos (${attachments.length})` : "Archivos" },
    { id: "detalles", label: "Detalles" },
    { id: "historial", label: "Historial" },
  ];

  return (
    <div className="space-y-3">
      <header className="border-b border-slate-200/80 pb-3">
        <Link
          href="/tickets"
          className={`mb-2 inline-flex items-center gap-1 text-xs font-medium ${waraAccent.link}`}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Volver a la lista
        </Link>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h1 className="text-base font-bold leading-snug text-slate-900 sm:text-lg">{ticket.title}</h1>
              <span className="font-mono text-[11px] text-slate-400">#{ticket.code}</span>
            </div>
            <p className="mt-0.5 text-sm text-slate-600">{companyName}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusBadgeClass(ticket.status as TicketStatus)}`}
              >
                {statusLabels[ticket.status as TicketStatus]}
              </span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${priorityBadgeClass(ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT")}`}
              >
                {priorityLabels[ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT"]}
              </span>
              {ticket.assignedTo ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                  <AgentAvatar name={ticket.assignedTo.name} size="sm" />
                  {ticket.assignedTo.name.split(" ")[0]}
                </span>
              ) : (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${waraAccent.chipMuted}`}>
                  Sin asignar
                </span>
              )}
            </div>
            <div className="mt-2">
              <TicketV2HeaderBadges ticketId={ticket.id} botPaused={!!ticket.botPaused} />
            </div>
          </div>
          <p className="shrink-0 text-[11px] text-slate-400" title={formatDateTimeAR(ticket.createdAt)}>
            Creado {formatDateTimeAR(ticket.createdAt)}
          </p>
        </div>
      </header>

      <div className="border-b border-slate-200">
        <div className="flex gap-0.5 overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                tab === t.id
                  ? `${waraAccent.tabActive} bg-[#4a0e1c]/[0.03]`
                  : "border-transparent text-slate-500 hover:text-slate-800"
              } ${waraAccent.ring}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "conversacion" ? (
        <div className="grid gap-3 xl:grid-cols-[1fr_17.5rem]">
          <div className="flex h-[min(560px,calc(100vh-13rem))] max-h-[min(560px,calc(100vh-13rem))] flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm">
            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
              <ConversationThread messages={conversation} />
            </div>
            <div className="shrink-0 border-t border-slate-200/80 bg-slate-50/30">
              <MessageComposer
                ticketId={ticket.id}
                customerId={ticket.customerId}
                botPaused={!!ticket.botPaused}
                onSent={refreshMessages}
                embedded
              />
            </div>
          </div>

          <aside className="space-y-2.5 xl:sticky xl:top-4 xl:self-start">
            <div className="rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm">
              {isAdmin ? (
                <AssignAgentDropdown
                  ticketId={ticket.id}
                  currentAgentId={ticket.assignedToUserId}
                  agentes={agentes}
                />
              ) : (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Asignado a
                  </p>
                  {ticket.assignedTo ? (
                    <div className="flex items-center gap-2 text-sm text-slate-800">
                      <AgentAvatar name={ticket.assignedTo.name} size="sm" />
                      {ticket.assignedTo.name}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Sin asignar (en cola)</p>
                  )}
                </div>
              )}
            </div>
            <ConversationSummary
              ticketId={ticket.id}
              initialSummary={ticket.aiSummary}
              incidentLabel={incidentTypeLabel}
              plate={plate}
              company={companyName}
              priority={ticket.priority}
            />
            <QuickActionsPanel ticketId={ticket.id} labMode={labMode} />
            <TicketPriorityPanel
              ticketId={ticket.id}
              currentPriority={ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT"}
            />
            <V2OperationPanel ticketId={ticket.id} botPaused={!!ticket.botPaused} />
          </aside>
        </div>
      ) : null}

      {tab === "archivos" ? (
        <div className="rounded-lg border border-slate-200/90 bg-white p-4 shadow-sm">
          {attachments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="mb-2 h-10 w-10 text-slate-300" aria-hidden />
              <p className="text-sm font-medium text-slate-600">Sin archivos adjuntos</p>
              <p className="mt-1 text-xs text-slate-400">
                Los archivos enviados en la conversación aparecerán acá.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {attachments.map((att, idx) => (
                <div
                  key={`${att.messageId}-${idx}`}
                  className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{att.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {fromLabels[att.from as "CUSTOMER" | "BOT" | "HUMAN"] || att.from} ·{" "}
                      {formatDateTimeAR(att.messageDate)}
                    </p>
                  </div>
                  <MessageAttachments attachments={[att]} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "detalles" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <DetailCard title="Datos operativos">
            <DetailRow label="Tipo de incidente" value={incidentTypeLabel} />
            <DetailRow label="Matrícula" value={plate || "Sin informar"} />
            <DetailRow label="Razón social" value={companyName || "Sin informar"} />
            <DetailRow
              label="Modo resolución"
              value={
                ticket.resolution
                  ? (resolutionModeLabels as Record<string, string>)[ticket.resolution] ||
                    ticket.resolution
                  : "Sin definir"
              }
            />
            <DetailRow
              label="Categoría"
              value={categoryLabels[ticket.category as keyof typeof categoryLabels] || ticket.category}
            />
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
        <div className="rounded-lg border border-slate-200/90 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-800">Línea de tiempo</p>
          <div className="space-y-2">
            <TimelineItem label="Ticket creado" date={formatDateTimeAR(ticket.createdAt)} />
            {conversation.slice(-5).map((msg) => (
              <TimelineItem
                key={msg.id}
                label={`Mensaje ${fromLabels[msg.from as "CUSTOMER" | "BOT" | "HUMAN"] || msg.from}`}
                date={formatDateTimeAR(msg.createdAt)}
                detail={msg.text?.slice(0, 80)}
              />
            ))}
            <TimelineItem label="Última actividad" date={formatDateTimeAR(ticket.lastMessageAt)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      <div className="space-y-1.5">{children}</div>
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
    <div className="flex gap-3 border-l-2 border-[#4a0e1c]/20 pl-3">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">{date}</p>
        {detail ? <p className="mt-0.5 text-xs text-slate-600">{detail}…</p> : null}
      </div>
    </div>
  );
}
