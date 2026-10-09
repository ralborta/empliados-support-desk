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
import { resolutionModeLabels } from "@/lib/types";
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
    botPausedSource?: string | null;
    channelSyncStatus?: string | null;
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
      deliveryStatus?: string | null;
      authorship?: string | null;
      clientAttemptId?: string | null;
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
      deliveryStatus: m.deliveryStatus,
      authorship: m.authorship,
      clientAttemptId: m.clientAttemptId,
    })),
  );
  const [botPaused, setBotPaused] = useState(!!ticket.botPaused);
  const [channelSyncStatus, setChannelSyncStatus] = useState(
    ticket.channelSyncStatus ?? "idle",
  );
  const [pauseSource, setPauseSource] = useState<string | null>(
    ticket.botPausedSource ?? null,
  );
  const [liveStatus, setLiveStatus] = useState(ticket.status);
  const [livePriority, setLivePriority] = useState(ticket.priority);
  const [liveAssignedTo, setLiveAssignedTo] = useState(ticket.assignedTo);
  const [liveAssignedToUserId, setLiveAssignedToUserId] = useState(ticket.assignedToUserId);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const refreshSeqRef = useRef(0);
  const localPauseAtRef = useRef(0);

  useEffect(() => {
    setBotPaused(!!ticket.botPaused);
    setChannelSyncStatus(ticket.channelSyncStatus ?? "idle");
    setPauseSource(ticket.botPausedSource ?? null);
    setLiveStatus(ticket.status);
    setLivePriority(ticket.priority);
    setLiveAssignedTo(ticket.assignedTo);
    setLiveAssignedToUserId(ticket.assignedToUserId);
  }, [ticket.botPaused, ticket.botPausedSource, ticket.channelSyncStatus, ticket.status, ticket.priority, ticket.assignedTo, ticket.assignedToUserId, ticket.id]);

  useEffect(() => {
    setConversation(
      (ticket.messages || []).map((m) => ({
        ...m,
        direction: m.direction,
      })),
    );
    refreshSeqRef.current += 1;
  }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps -- solo al cambiar de ticket

  const applyBotPausedFromServer = useCallback((next: boolean) => {
    // Evita que un poll atrasado pise una pausa/reactivación local reciente (<3s).
    if (Date.now() - localPauseAtRef.current < 3000) return;
    setBotPaused(next);
  }, []);

  const setBotPausedLocal = useCallback((next: boolean) => {
    localPauseAtRef.current = Date.now();
    setBotPaused(next);
  }, []);

  const refreshMessages = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      if (seq !== refreshSeqRef.current) return;
      if (Array.isArray(data.messages)) {
        setConversation(data.messages);
      }
      const meta = data.ticket;
      if (meta && typeof meta === "object") {
        if (typeof meta.status === "string") setLiveStatus(meta.status);
        if (typeof meta.priority === "string") setLivePriority(meta.priority);
        if ("assignedToUserId" in meta) {
          setLiveAssignedToUserId(
            meta.assignedToUserId == null ? null : String(meta.assignedToUserId),
          );
        }
        if ("assignedTo" in meta) {
          setLiveAssignedTo(
            meta.assignedTo && typeof meta.assignedTo === "object" && "name" in meta.assignedTo
              ? (meta.assignedTo as { name: string })
              : null,
          );
        }
        if (typeof meta.botPaused === "boolean") {
          applyBotPausedFromServer(meta.botPaused);
        }
        if (typeof meta.channelSyncStatus === "string") {
          setChannelSyncStatus(meta.channelSyncStatus);
        }
        if ("botPausedSource" in meta) {
          setPauseSource(
            meta.botPausedSource == null ? null : String(meta.botPausedSource),
          );
        }
      }
    } catch {
      /* ignore */
    }
  }, [ticket.id, applyBotPausedFromServer]);

  // Poll mientras el ticket está abierto (cualquier pestaña); al volver a visible también corre.
  usePollWhenVisible(refreshMessages, 5000, true);

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
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${statusBadgeClass(liveStatus as TicketStatus)}`}
              >
                {statusLabels[liveStatus as TicketStatus]}
              </span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${priorityBadgeClass(livePriority as "LOW" | "NORMAL" | "HIGH" | "URGENT")}`}
              >
                {priorityLabels[livePriority as "LOW" | "NORMAL" | "HIGH" | "URGENT"]}
              </span>
              {liveAssignedTo ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                  <AgentAvatar name={liveAssignedTo.name} size="sm" />
                  {liveAssignedTo.name.split(" ")[0]}
                </span>
              ) : (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${waraAccent.chipMuted}`}>
                  Sin asignar
                </span>
              )}
            </div>
            <div className="mt-2">
              <TicketV2HeaderBadges ticketId={ticket.id} botPaused={botPaused} />
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

      <div className={tab === "conversacion" ? "grid gap-3 xl:grid-cols-[1fr_17.5rem]" : "hidden"}>
          <div className="flex h-[min(560px,calc(100vh-13rem))] max-h-[min(560px,calc(100vh-13rem))] flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-white shadow-sm">
            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
              <ConversationThread messages={conversation} />
            </div>
            <div className="shrink-0 border-t border-slate-200/80 bg-slate-50/30">
              <MessageComposer
                ticketId={ticket.id}
                customerId={ticket.customerId}
                botPaused={botPaused}
                channelSyncStatus={channelSyncStatus}
                pauseSource={pauseSource}
                onBotPausedChange={setBotPausedLocal}
                onChannelSyncStatusChange={setChannelSyncStatus}
                onPauseSourceChange={setPauseSource}
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
                  currentAgentId={liveAssignedToUserId}
                  agentes={agentes}
                />
              ) : (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Asignado a
                  </p>
                  {liveAssignedTo ? (
                    <div className="flex items-center gap-2 text-sm text-slate-800">
                      <AgentAvatar name={liveAssignedTo.name} size="sm" />
                      {liveAssignedTo.name}
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
              priority={livePriority}
            />
            <QuickActionsPanel ticketId={ticket.id} labMode={labMode} />
            <TicketPriorityPanel
              ticketId={ticket.id}
              currentPriority={livePriority as "LOW" | "NORMAL" | "HIGH" | "URGENT"}
            />
            <V2OperationPanel ticketId={ticket.id} botPaused={botPaused} />
          </aside>
      </div>

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
