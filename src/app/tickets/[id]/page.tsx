import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import {
  priorityLabels,
  statusLabels,
  fromLabels,
} from "@/lib/tickets";
type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
import { MessageComposer } from "@/components/tickets/MessageComposer";
import { StatusActions } from "@/components/tickets/StatusActions";

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      customer: true,
      assignedTo: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticket) {
    notFound();
  }

  const conversation = ticket.messages;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/tickets" className="text-sm text-indigo-600 hover:underline">
              ← Volver a tickets
            </Link>
            <h1 className="text-2xl font-semibold text-slate-900">Ticket {ticket.code}</h1>
            <p className="text-sm text-slate-500">Cliente: {ticket.customer?.name || ticket.customer?.phone}</p>
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

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800">Conversación</div>
              <div className="mt-3 space-y-3">
                {conversation.length === 0 ? (
                  <div className="text-sm text-slate-500">Sin mensajes aún.</div>
                ) : (
                  conversation.map((msg: { id: string; from: string; text: string; createdAt: Date }) => (
                    <div key={msg.id} className="flex flex-col gap-1">
                      <div className="text-xs text-slate-500">
                        {fromLabels[msg.from as "CUSTOMER" | "BOT" | "HUMAN"]} · {msg.createdAt.toLocaleString("es-AR")}
                      </div>
                      <div
                        className={`max-w-2xl rounded-2xl px-4 py-3 text-sm shadow-sm ${
                          msg.from === "CUSTOMER"
                            ? "bg-slate-100 text-slate-800"
                            : msg.from === "BOT"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-blue-100 text-blue-900"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <MessageComposer ticketId={ticket.id} />
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800">Datos del cliente</div>
              <div className="mt-2 text-sm text-slate-600">
                <div><span className="font-semibold">Nombre:</span> {ticket.customer?.name || "No especificado"}</div>
                <div><span className="font-semibold">Teléfono:</span> {ticket.customer?.phone}</div>
                <div><span className="font-semibold">Asignado:</span> {ticket.assignedTo?.name || "Sin asignar"}</div>
              </div>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="text-sm font-semibold text-slate-800">Acciones rápidas</div>
              <div className="mt-2 space-y-2 text-sm text-slate-600">
                <p>Define notas internas, cambia estado o responde al cliente.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
