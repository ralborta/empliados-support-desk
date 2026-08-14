"use client";

import { Loader2 } from "lucide-react";
import { useAtilioConfig } from "@/components/configuracion/AtilioConfigContext";

export default function AgentConfig() {
  const { prompt, setPrompt, isLoading, isSaving } = useAtilioConfig();

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="relative">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={`Ejemplo:\n- Saluda según la hora y preséntate como Atilio una sola vez.\n- Mantén respuestas breves, claras y profesionales.\n- Si hay {aiImage}, úsala como contexto sin inventar datos.\n- Si no hay datos suficientes, pide solo lo mínimo necesario.`}
        className="h-80 w-full resize-none rounded-xl border-2 border-slate-200 bg-slate-50/50 p-5 font-mono text-sm transition-all focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        disabled={isSaving}
      />
      <div className="pointer-events-none absolute bottom-4 right-4 text-xs text-slate-400">
        {prompt.length} caracteres
      </div>
    </div>
  );
}
