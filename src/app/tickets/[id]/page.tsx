import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  priorityLabels,
  statusLabels,
  fromLabels,
  categoryLabels,
} from "@/lib/tickets";
type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
import { MessageComposer } from "@/components/tickets/MessageComposer";
import { StatusActions } from "@/components/tickets/StatusActions";
import { ConversationSummary } from "@/components/tickets/ConversationSummary";
import { AssignAgentDropdown } from "@/components/tickets/AssignAgentDropdown";
import { MessageAttachments } from "@/components/tickets/MessageAttachments";
import { QuickActionsPanel } from "@/components/tickets/QuickActionsPanel";
import { resolutionModeLabels, waraIncidentLabels, type WaraIncidentType } from "@/lib/wara";
import { User } from "lucide-react";

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      customer: true,
      assignedTo: true,
      messages: { 
        orderBy: { createdAt: "asc" },
        take: 1000, // Asegurar que se carguen todos los mensajes
      },
    },
  });

  if (!ticket) {
    notFound();
  }

  // Obtener lista de agentes para el dropdown
  const agentes = await prisma.agentUser.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  const conversation = ticket.messages || [];
  const lastInboundWithWara = [...conversation]
    .reverse()
    .find((msg: any) => msg?.rawPayload?.wara);
  const wara = (lastInboundWithWara as any)?.rawPayload?.wara;

  const incidentTypeKey = ticket.incidentType;
  const incidentTypeLabel =
    incidentTypeKey && incidentTypeKey in waraIncidentLabels
      ? waraIncidentLabels[incidentTypeKey as WaraIncidentType]
      : wara?.incidentTypeLabel || categoryLabels[ticket.category as keyof typeof categoryLabels];

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/tickets" className="text-sm text-indigo-600 hover:underline">
              ← Volver a tickets
            </Link>
            <h1 className="text-2xl font-semibold text-slate-900">Ticket {ticket.code}</h1>
            <p className="text-sm text-slate-600">
              <span className="font-medium">Empresa:</span> {ticket.customer?.name || "Desconocida"} • 
              <span className="font-medium"> Contacto:</span> {ticket.contactName}
            </p>
            <p className="text-xs text-slate-500">📱 {ticket.customer?.phone}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="inline-flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Estado:</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-800">
                {statusLabels[ticket.status as TicketStatus]}
              </span>
              <span className="text-sm font-semibold text-slate-700">Prioridad:</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-800">
                {priorityLabels[ticket.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT"]}
              </span>
            </div>
            <StatusActions ticketId={ticket.id} currentStatus={ticket.status as TicketStatus} />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="mb-3 text-sm font-semibold text-slate-800">Datos operativos del caso</div>
              <div className="space-y-2 text-sm text-slate-700">
                <div><span className="font-semibold">Tipo de incidente:</span> {incidentTypeLabel}</div>
                <div><span className="font-semibold">Matrícula:</span> {wara?.plate || "Sin informar"}</div>
                <div><span className="font-semibold">Razón social:</span> {ticket.customer?.name || "Sin informar"}</div>
                <div><span className="font-semibold">Modo resolución:</span> {ticket.resolution ? (resolutionModeLabels as any)[ticket.resolution] || ticket.resolution : "Sin definir"}</div>
                <div><span className="font-semibold">Creado:</span> {ticket.createdAt.toLocaleString("es-AR")}</div>
                <div><span className="font-semibold">Última actividad:</span> {ticket.lastMessageAt.toLocaleString("es-AR")}</div>
              </div>
              {wara?.missingData?.length > 0 && (
                <div className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                  Faltan datos: {wara.missingData.join(", ")}
                </div>
              )}
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800 mb-3">Datos del contacto</div>
              <div className="space-y-2 text-sm text-slate-600">
                <div><span className="font-semibold">Nombre:</span> {ticket.contactName || "No especificado"}</div>
                <div><span className="font-semibold">Empresa:</span> {ticket.customer?.name || "No especificado"}</div>
                <div><span className="font-semibold">Teléfono:</span> {ticket.customer?.phone}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4 xl:col-span-6">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800">Conversación</div>
              <div className="mt-3 space-y-3">
                {conversation.length === 0 ? (
                  <div className="text-sm text-slate-500">Sin mensajes aún.</div>
                ) : (
                  conversation.map((msg: any) => {
                    const createdAt = msg.createdAt instanceof Date 
                      ? msg.createdAt 
                      : new Date(msg.createdAt);
                    const fromLabel = fromLabels[msg.from as "CUSTOMER" | "BOT" | "HUMAN"] || msg.from;
                    
                    return (
                      <div key={msg.id} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          {msg.from === "BOT" ? (
                            <>
                              <Image
                                src="/atilio-logo.png"
                                alt=""
                                width={22}
                                height={22}
                                className="h-[22px] w-[22px] shrink-0 rounded-md object-contain ring-1 ring-rose-200/80"
                                aria-hidden
                              />
                              <span className="font-medium text-slate-700">{fromLabel}</span>
                            </>
                          ) : msg.from === "CUSTOMER" ? (
                            <>
                              <span
                                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-slate-200/90 text-slate-600 ring-1 ring-slate-300/70"
                                aria-hidden
                              >
                                <User className="h-3.5 w-3.5" strokeWidth={2.25} />
                              </span>
                              <span className="font-medium text-slate-700">{fromLabel}</span>
                            </>
                          ) : (
                            <span>{fromLabel}</span>
                          )}
                          <span className="text-slate-400">·</span>
                          <span>{createdAt.toLocaleString("es-AR")}</span>
                        </div>
                        <div>
                          <div
                            className={`max-w-2xl rounded-2xl px-4 py-3 text-sm shadow-sm ${
                              msg.from === "CUSTOMER"
                                ? "bg-slate-100 text-slate-800"
                                : msg.from === "BOT"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-blue-100 text-blue-900"
                            }`}
                          >
                            {msg.text || "[Sin texto]"}
                          </div>
                          {msg.attachments && (
                            <MessageAttachments attachments={msg.attachments as any} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <MessageComposer
              ticketId={ticket.id}
              customerId={ticket.customerId}
              botPaused={!!ticket.customer?.botPausedAt}
            />
          </div>

          <div className="space-y-3 xl:col-span-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
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
      </div>
    </div>
  );
}
