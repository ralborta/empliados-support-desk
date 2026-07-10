import type { Prisma } from "@prisma/client";

export const TICKETS_PAGE_SIZE = 15;

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export type TicketListSearchParams = {
  q?: string;
  status?: string;
  priority?: string;
  assigned?: string;
  page?: string;
};

export type TicketListFixedFilter = {
  status?: TicketStatus | TicketStatus[];
  priority?: TicketPriority;
};

const VALID_STATUSES = new Set<string>([
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
]);
const VALID_PRIORITIES = new Set<string>(["LOW", "NORMAL", "HIGH", "URGENT"]);

export function parseTicketListPage(raw?: string): number {
  const n = parseInt(raw || "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function buildTicketWhere(
  params: TicketListSearchParams,
  fixed?: TicketListFixedFilter
): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {};

  if (fixed?.status) {
    where.status = Array.isArray(fixed.status) ? { in: fixed.status } : fixed.status;
  } else if (params.status && params.status !== "all" && VALID_STATUSES.has(params.status)) {
    where.status = params.status as TicketStatus;
  }

  if (fixed?.priority) {
    where.priority = fixed.priority;
  } else if (params.priority && params.priority !== "all" && VALID_PRIORITIES.has(params.priority)) {
    where.priority = params.priority as TicketPriority;
  }

  if (params.assigned === "none") {
    where.assignedToUserId = null;
  } else if (params.assigned && params.assigned !== "all") {
    where.assignedToUserId = params.assigned;
  }

  const search = params.q?.trim();
  if (search) {
    where.OR = [
      { code: { contains: search, mode: "insensitive" } },
      { title: { contains: search, mode: "insensitive" } },
      { contactName: { contains: search, mode: "insensitive" } },
      { customer: { name: { contains: search, mode: "insensitive" } } },
      { customer: { companyName: { contains: search, mode: "insensitive" } } },
      { customer: { phone: { contains: search, mode: "insensitive" } } },
      { assignedTo: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  return where;
}

export const ticketListSelect = {
  id: true,
  code: true,
  title: true,
  contactName: true,
  status: true,
  priority: true,
  lastMessageAt: true,
  createdAt: true,
  customer: {
    select: {
      name: true,
      companyName: true,
      licensePlate: true,
      phone: true,
    },
  },
  assignedTo: {
    select: {
      name: true,
    },
  },
} as const;

export function buildPageHref(basePath: string, params: TicketListSearchParams, page: number): string {
  const sp = new URLSearchParams();
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.priority && params.priority !== "all") sp.set("priority", params.priority);
  if (params.assigned && params.assigned !== "all") sp.set("assigned", params.assigned);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
