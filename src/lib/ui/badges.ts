export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export function statusBadgeClass(status: TicketStatus): string {
  switch (status) {
    case "OPEN":
      return "bg-blue-50 text-blue-700 ring-blue-100";
    case "IN_PROGRESS":
      return "bg-amber-50 text-amber-700 ring-amber-100";
    case "WAITING_CUSTOMER":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "RESOLVED":
      return "bg-teal-50 text-teal-700 ring-teal-100";
    case "CLOSED":
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export function priorityBadgeClass(priority: TicketPriority): string {
  switch (priority) {
    case "URGENT":
      return "bg-red-50 text-red-700 ring-red-100";
    case "HIGH":
      return "bg-orange-50 text-orange-700 ring-orange-100";
    case "NORMAL":
      return "bg-emerald-50 text-emerald-700 ring-emerald-100";
    case "LOW":
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export function statusBarColor(status: string): string {
  switch (status) {
    case "OPEN":
      return "bg-blue-500";
    case "IN_PROGRESS":
      return "bg-amber-500";
    case "WAITING_CUSTOMER":
      return "bg-emerald-500";
    case "RESOLVED":
      return "bg-teal-500";
    case "CLOSED":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}

export function priorityBarColor(priority: string): string {
  switch (priority) {
    case "URGENT":
      return "bg-red-500";
    case "HIGH":
      return "bg-orange-500";
    case "NORMAL":
      return "bg-emerald-500";
    case "LOW":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}

export function priorityDonutColor(priority: string): string {
  switch (priority) {
    case "URGENT":
      return "#ef4444";
    case "HIGH":
      return "#f97316";
    case "NORMAL":
      return "#22c55e";
    case "LOW":
      return "#94a3b8";
    default:
      return "#cbd5e1";
  }
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
