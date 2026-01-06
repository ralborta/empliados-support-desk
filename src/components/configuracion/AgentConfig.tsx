"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, AlertCircle, Brain, Save } from "lucide-react";

const DEFAULT_PROMPT =
  "Eres un asistente virtual amigable y profesional. Ayuda a los usuarios con sus consultas de manera clara y concisa. Responde siempre de forma útil y respetuosa.";

export default function AgentConfig() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
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
      if (data.content) {
        setPrompt(data.content);
      }
    } catch (error) {
      console.error("Error loading prompt:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!prompt.trim()) {
      setMessage({ type: "error", text: "El prompt no puede estar vacío" });
      setTimeout(() => setMessage(null), 3000);
      return;
    }

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

      setMessage({ type: "success", text: "Configuración guardada correctamente" });
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
          <p className="text-sm text-slate-500 mt-0.5">Configura cómo debe comportarse tu asistente de IA</p>
        </div>
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
          placeholder="Escribe aquí las instrucciones para el asistente de IA..."
          className="w-full h-80 p-5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-none text-sm bg-slate-50/50 transition-all font-mono"
          disabled={isSaving}
        />
        <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-slate-400">
          <span>{prompt.length} caracteres</span>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
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
