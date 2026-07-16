"use client";

import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type AlertDialogProps = {
  open: boolean;
  title: string;
  description: React.ReactNode;
  variant?: "success" | "error" | "info";
  onClose: () => void;
};

export function AlertDialog({
  open,
  title,
  description,
  variant = "info",
  onClose,
}: AlertDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const icon =
    variant === "success" ? (
      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
    ) : variant === "error" ? (
      <AlertCircle className="h-5 w-5 text-red-600" />
    ) : (
      <Info className="h-5 w-5 text-violet-600" />
    );

  const iconWrap =
    variant === "success"
      ? "bg-emerald-50 ring-emerald-100"
      : variant === "error"
        ? "bg-red-50 ring-red-100"
        : "bg-violet-50 ring-violet-100";

  const buttonClass =
    variant === "error"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-violet-600 hover:bg-violet-700";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[1px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1 ${iconWrap}`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 id="alert-dialog-title" className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div id="alert-dialog-description" className="mt-2 text-sm leading-relaxed text-slate-600">
              {description}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm ${buttonClass}`}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
