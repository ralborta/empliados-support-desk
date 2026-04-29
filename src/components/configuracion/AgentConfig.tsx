"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Brain, Save } from "lucide-react";

export default function AgentConfig() {
  const [prompt, setPrompt] = useState("");
  const [fullPrompt, setFullPrompt] = useState("");
  const [usesTemplate, setUsesTemplate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadPrompt();
  }, []);

  const loadPrompt = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/builderbot/prompt");
      const data = await response.json();
      setPrompt(data.content || "");
      setFullPrompt(data.fullContent || "");
      setUsesTemplate(!!data.usesTemplate);
    } catch (error) {
      console.error("Error loading prompt:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/builderbot/prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: prompt }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "No se pudo guardar");
      }

      const data = await response.json();
      setFullPrompt(data.fullContent || "");
      setUsesTemplate(!!data.usesTemplate);
      setMessage({ type: "success", text: "Prompt actualizado correctamente" });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "No se pudo guardar, intenta nuevamente",
      });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const downloadBackup = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadFinalPrompt = () => {
    if (!fullPrompt) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBackup(fullPrompt, `prompt-final-${stamp}.txt`);
  };

  const handleDownloadEditablePrompt = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBackup(prompt || "", `prompt-editable-${stamp}.txt`);
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Brain className="w-5 h-5 text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Configuración del Agente</h2>
        </div>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
          <Brain className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Configuración del Agente</h2>
          <p className="text-sm text-slate-500 mt-0.5">Edita solo el bloque personalizado; el prompt base queda protegido</p>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        {usesTemplate
          ? "Modo plantilla activo: se combina Prompt Base + tu bloque editable."
          : "Prompt sin plantilla detectado: al guardar se migrará automáticamente al nuevo formato."}
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold">{message.text}</span>
        </div>
      )}

      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Escribe aquí las instrucciones editables para la interacción básica..."
          className="w-full h-80 p-5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-none text-sm bg-slate-50/50 transition-all font-mono"
          disabled={isSaving}
        />
        <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-slate-400">
          <span>{prompt.length} caracteres</span>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadEditablePrompt}
            type="button"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Descargar bloque editable
          </button>
          <button
            onClick={handleDownloadFinalPrompt}
            type="button"
            disabled={!fullPrompt}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Descargar prompt final
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm hover:shadow-md"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Guardando...</span>
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              <span>Guardar Cambios</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
