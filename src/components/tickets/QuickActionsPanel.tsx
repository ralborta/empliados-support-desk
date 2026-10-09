"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { waraAccent } from "@/lib/ui/waraTheme";

type QuickAction =
  | "request_data"
  | "in_analysis"
  | "derive"
  | "resolve"
  | "close"
  | "internal_note";

const IRREVERSIBLE: QuickAction[] = ["resolve", "close"];

const quickActionItems: {
  action: QuickAction;
  label: string;
  variant: "primary" | "secondary" | "destructive" | "note";
}[] = [
  { action: "resolve", label: "Resolver", variant: "primary" },
  { action: "in_analysis", label: "Marcar en análisis", variant: "secondary" },
  { action: "request_data", label: "Solicitar más datos", variant: "secondary" },
  { action: "derive", label: "Derivar", variant: "secondary" },
  { action: "close", label: "Cerrar", variant: "destructive" },
  { action: "internal_note", label: "Nota interna", variant: "note" },
];

function btnClass(variant: (typeof quickActionItems)[number]["variant"]): string {
  const base =
    "flex min-h-[2.25rem] items-center justify-center rounded-lg border px-2.5 py-1.5 text-center text-xs font-semibold transition disabled:opacity-50 " +
    waraAccent.ring;
  switch (variant) {
    case "primary":
      return `${base} border-[#4a0e1c] bg-[#4a0e1c] text-white hover:bg-[#6b1428]`;
    case "destructive":
      return `${base} border-red-200 bg-white text-red-700 hover:bg-red-50`;
    case "note":
      return `${base} border-amber-200/80 bg-amber-50/80 text-amber-950 hover:bg-amber-100/80`;
    default:
      return `${base} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
  }
}

export function QuickActionsPanel({
  ticketId,
  labMode = false,
}: {
  ticketId: string;
  labMode?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionWarning, setActionWarning] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<QuickAction | null>(null);

  const runQuickAction = (action: QuickAction) => {
    setActionError(null);
    setActionWarning(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/quick-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setActionError(
            res.status === 401
              ? "Sesión vencida. Recargá la página e intentá de nuevo."
              : payload?.error || "No se pudo completar la acción",
          );
          return;
        }
        setPendingAction(null);
        if (typeof payload?.warning === "string" && payload.warning) {
          setActionWarning(payload.warning);
        }
        router.refresh();
      } catch {
        setActionError("Error de red. Intentá de nuevo.");
      }
    });
  };

  const handleClick = (action: QuickAction) => {
    if (IRREVERSIBLE.includes(action)) {
      setPendingAction(action);
      return;
    }
    runQuickAction(action);
  };

  const confirmMeta: Record<string, { title: string; description: string; label: string }> = {
    resolve: {
      title: "Resolver ticket",
      description: labMode
        ? "El ticket quedará marcado como resuelto (lab: sin WhatsApp real)."
        : "El ticket quedará marcado como resuelto y se enviará un mensaje al cliente por WhatsApp.",
      label: "Resolver",
    },
    close: {
      title: "Cerrar ticket",
      description: "El ticket se cerrará definitivamente. Esta acción es difícil de revertir.",
      label: "Cerrar ticket",
    },
  };

  return (
    <div className="rounded-lg border border-slate-200/90 bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Acciones rápidas</p>
      <p className="mb-2.5 text-[11px] leading-snug text-slate-500">
        {labMode
          ? "Actualizan el estado y registran mensaje (lab: sin WhatsApp real)."
          : "Actualizan el estado y envían el mensaje al cliente por WhatsApp."}
      </p>
      {actionError ? (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {actionError}
        </div>
      ) : null}
      {actionWarning ? (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {actionWarning}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        {quickActionItems.map(({ action, label, variant }) => (
          <button
            key={action}
            type="button"
            className={btnClass(variant)}
            disabled={isPending}
            onClick={() => handleClick(action)}
          >
            {label}
          </button>
        ))}
      </div>

      {pendingAction ? (
        <ConfirmDialog
          open
          title={confirmMeta[pendingAction]?.title ?? "Confirmar acción"}
          description={confirmMeta[pendingAction]?.description ?? "¿Continuar?"}
          confirmLabel={confirmMeta[pendingAction]?.label ?? "Confirmar"}
          variant={pendingAction === "close" ? "danger" : "default"}
          loading={isPending}
          onConfirm={() => runQuickAction(pendingAction)}
          onCancel={() => {
            if (!isPending) setPendingAction(null);
          }}
        />
      ) : null}
    </div>
  );
}
