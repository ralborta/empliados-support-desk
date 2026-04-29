"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, AlertCircle, Brain, Save, Archive, RotateCcw } from "lucide-react";

const LOCAL_BACKUP_KEY = "empliados-support-desk:agent-prompt-local-backup:v1";

type LocalPromptBackupV1 = {
  v: 1;
  savedAt: string;
  editable: string;
  fullContent: string;
  usesTemplate: boolean;
};

function readLocalBackup(): LocalPromptBackupV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LocalPromptBackupV1;
    if (data.v !== 1 || typeof data.editable !== "string" || typeof data.fullContent !== "string") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeLocalBackup(data: LocalPromptBackupV1) {
  localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(data));
}

export default function AgentConfig() {
  const [prompt, setPrompt] = useState("");
  const [fullPrompt, setFullPrompt] = useState("");
  const [usesTemplate, setUsesTemplate] = useState(false);
  const [localBackupAt, setLocalBackupAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const refreshLocalBackupMeta = useCallback(() => {
    const b = readLocalBackup();
    setLocalBackupAt(b?.savedAt ?? null);
  }, []);

  useEffect(() => {
    loadPrompt();
  }, []);

  useEffect(() => {
    refreshLocalBackupMeta();
  }, [refreshLocalBackupMeta]);

  const loadPrompt = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/builderbot/prompt");
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo cargar el prompt");
      }
      const data = await response.json();
      setPrompt(data.content || "");
      setFullPrompt(data.fullContent || "");
      setUsesTemplate(!!data.usesTemplate);
      if (data.warning) {
        setMessage({ type: "error", text: String(data.warning) });
      }
    } catch (error) {
      console.error("Error loading prompt:", error);
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "No se pudo cargar el prompt",
      });
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
        body: JSON.stringify({ content: prompt, existingFullContent: fullPrompt }),
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

  const handleSaveLocalBackup = () => {
    try {
      const savedAt = new Date().toISOString();
      writeLocalBackup({
        v: 1,
        savedAt,
        editable: prompt,
        fullContent: fullPrompt || "",
        usesTemplate,
      });
      refreshLocalBackupMeta();
      setMessage({
        type: "success",
        text: "Respaldo guardado en este navegador (no en servidor ni base de datos).",
      });
      setTimeout(() => setMessage(null), 4000);
    } catch {
      setMessage({
        type: "error",
        text: "No se pudo guardar el respaldo local (p. ej. almacenamiento lleno o privado).",
      });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleRestoreLocalBackup = () => {
    const b = readLocalBackup();
    if (!b) {
      setMessage({ type: "error", text: "No hay respaldo local en este navegador." });
      setTimeout(() => setMessage(null), 4000);
      return;
    }
    if (
      !window.confirm(
        "¿Recuperar el respaldo local? Se reemplaza lo que ves en pantalla (no se envía a BuilderBot hasta que pulses Guardar cambios)."
      )
    ) {
      return;
    }
    setPrompt(b.editable);
    setFullPrompt(b.fullContent);
    setUsesTemplate(b.usesTemplate);
    setMessage({
      type: "success",
      text: "Respaldo recuperado en pantalla. Revisá el texto y pulsá Guardar cambios para subirlo a BuilderBot.",
    });
    setTimeout(() => setMessage(null), 5000);
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
      <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-900">
        <p className="font-semibold">Guía rápida del bloque editable</p>
        <p className="mt-1">
          Escribe solo instrucciones de interacción básica (saludo, tono y estilo). No pegues aquí el prompt final completo.
        </p>
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
          placeholder={`Ejemplo:\n- Saluda según la hora y preséntate como Atilio una sola vez.\n- Mantén respuestas breves, claras y profesionales.\n- Si hay {aiImage}, úsala como contexto sin inventar datos.\n- Si no hay datos suficientes, pide solo lo mínimo necesario.`}
          className="w-full h-80 p-5 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-none text-sm bg-slate-50/50 transition-all font-mono"
          disabled={isSaving}
        />
        <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs text-slate-400">
          <span>{prompt.length} caracteres</span>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
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

        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
          <p className="font-semibold mb-2">Respaldo en este navegador (sin base de datos)</p>
          <p className="text-xs text-amber-900/90 mb-3">
            Se guarda solo en el almacenamiento local del navegador. Otro equipo u otro navegador no lo ve. Limpiar datos del sitio borra este respaldo.
          </p>
          {localBackupAt && (
            <p className="text-xs text-amber-900/80 mb-3">
              Último respaldo local:{" "}
              <span className="font-mono">{new Date(localBackupAt).toLocaleString()}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSaveLocalBackup}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-50"
            >
              <Archive className="h-4 w-4 shrink-0" />
              Guardar respaldo local
            </button>
            <button
              type="button"
              onClick={handleRestoreLocalBackup}
              disabled={!localBackupAt}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-4 w-4 shrink-0" />
              Recuperar respaldo local
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
