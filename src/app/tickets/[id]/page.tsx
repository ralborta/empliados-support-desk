import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { categoryLabels } from "@/lib/tickets";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { TicketDetailView } from "@/components/tickets/TicketDetailView";
import { waraIncidentLabels, type WaraIncidentType } from "@/lib/wara";

const DISPLAY_TZ = process.env.APP_TIMEZONE?.trim() || "America/Argentina/Buenos_Aires";

function formatDateTimeAR(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

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
        take: 1000,
      },
    },
  });

  if (!ticket) {
    notFound();
  }

  const agentes = await prisma.agentUser.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  const conversation = ticket.messages || [];
  const lastInboundWithWara = [...conversation]
    .reverse()
    .find((msg) => (msg.rawPayload as Record<string, unknown> | null)?.wara);
  const wara = (lastInboundWithWara?.rawPayload as Record<string, unknown> | undefined)?.wara as
    | Record<string, unknown>
    | null
    | undefined;

  const incidentTypeKey = ticket.incidentType;
  const incidentTypeLabel =
    incidentTypeKey && incidentTypeKey in waraIncidentLabels
      ? waraIncidentLabels[incidentTypeKey as WaraIncidentType]
      : (wara?.incidentTypeLabel as string) ||
        categoryLabels[ticket.category as keyof typeof categoryLabels];

  return (
    <TicketsLayout showHeader={false}>
      <TicketDetailView
        ticket={{
          id: ticket.id,
          code: ticket.code,
          title: ticket.title,
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          resolution: ticket.resolution,
          incidentType: ticket.incidentType,
          contactName: ticket.contactName,
          createdAt: ticket.createdAt.toISOString(),
          lastMessageAt: ticket.lastMessageAt.toISOString(),
          aiSummary: ticket.aiSummary,
          assignedToUserId: ticket.assignedToUserId,
          customerId: ticket.customerId,
          customer: ticket.customer
            ? {
                name: ticket.customer.name,
                companyName: ticket.customer.companyName,
                licensePlate: ticket.customer.licensePlate,
                phone: ticket.customer.phone,
                botPausedAt: ticket.customer.botPausedAt,
              }
            : null,
          assignedTo: ticket.assignedTo,
          messages: conversation.map((msg) => ({
            id: msg.id,
            from: msg.from,
            text: msg.text,
            createdAt: msg.createdAt.toISOString(),
            attachments: msg.attachments,
            rawPayload: msg.rawPayload,
          })),
        }}
        agentes={agentes}
        wara={wara ?? null}
        incidentTypeLabel={incidentTypeLabel}
        formatDateTimeAR={(v) => formatDateTimeAR(v)}
      />
    </TicketsLayout>
  );
}
