"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Layers,
  Loader2,
  Save,
} from "lucide-react";

type ModulePrompt = {
  key: string;
  name: string;
  description: string;
  flowLabel: string;
  content: string;
  sortOrder: number;
  updatedAt: string;
};

type ModuleDraft = {
  content: string;
  dirty: boolean;
};

function localBackupKey(moduleKey: string) {
  return `empliados-support-desk:module-prompt:${moduleKey}:v1`;
}

export default function ModulePromptsPanel() {
  const [modules, setModules] = useState<ModulePrompt[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ModuleDraft>>({});
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadModules = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/builderbot/prompts");
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudieron cargar los módulos");
      }
      const data = await response.json();
      const list = (data.modules || []) as ModulePrompt[];
      setModules(list);
      setDrafts(
        Object.fromEntries(list.map((m) => [m.key, { content: m.content, dirty: false }]))
      );
      setSelectedKey((prev) => prev || list[0]?.key || "");
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "No se pudieron cargar los prompts",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  const selectedModule = modules.find((m) => m.key === selectedKey) ?? null;
  const selectedDraft = selectedKey ? drafts[selectedKey] : null;

  const updateDraft = (key: string, content: string) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: { content, dirty: true },
    }));
  };

  const handleSelectModule = (nextKey: string) => {
    if (nextKey === selectedKey) return;
    const currentDraft = selectedKey ? drafts[selectedKey] : null;
    if (currentDraft?.dirty) {
      const ok = window.confirm(
        "Tenés cambios sin guardar. ¿Cambiar de módulo igual? Se pierde lo que editaste."
      );
      if (!ok) return;
      setDrafts((prev) => {
        const mod = modules.find((m) => m.key === selectedKey);
        if (!mod || !prev[selectedKey]) return prev;
        return {
          ...prev,
          [selectedKey]: { content: mod.content, dirty: false },
        };
      });
    }
    setSelectedKey(nextKey);
  };

  const handleSave = async (key: string) => {
    const draft = drafts[key];
    if (!draft) return;

    setSavingKey(key);
    setMessage(null);
    try {
      const response = await fetch(`/api/builderbot/prompts/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft.content }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || "No se pudo guardar");
      }
      const saved = await response.json();
      setModules((prev) =>
        prev.map((m) =>
          m.key === key ? { ...m, content: saved.content, updatedAt: saved.updatedAt } : m
        )
      );
      setDrafts((prev) => ({
        ...prev,
        [key]: { content: saved.content, dirty: false },
      }));
      try {
        localStorage.setItem(
          localBackupKey(key),
          JSON.stringify({ savedAt: new Date().toISOString(), content: saved.content })
        );
      } catch {
        // ignore localStorage failures
      }
      setMessage({
        type: "success",
        text: `Cambios guardados en «${saved.name}».`,
      });
      setTimeout(() => setMessage(null), 4000);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "No se pudo guardar",
      });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setSavingKey(null);
    }
  };

  const handleCopy = async (key: string) => {
    const draft = drafts[key];
    if (!draft?.content) return;
    try {
      await navigator.clipboard.writeText(draft.content);
      setMessage({ type: "success", text: "Texto copiado al portapapeles" });
      setTimeout(() => setMessage(null), 2500);
    } catch {
      setMessage({ type: "error", text: "No se pudo copiar" });
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const handleDownload = (mod: ModulePrompt) => {
    const draft = drafts[mod.key];
    if (!draft) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([draft.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atilio-${mod.key}-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
            <Layers className="w-5 h-5 text-violet-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Prompts por trámite</h2>
        </div>
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
          <Layers className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Prompts por trámite</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Cada trámite (odómetro, consulta, certificados, etc.) tiene su propio texto. Elegí cuál querés
            editar.
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 p-4 rounded-xl flex items-center gap-3 ${
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

      <label className="block mb-4">
        <span className="text-sm font-semibold text-slate-800 mb-2 block">Trámite</span>
        <select
          value={selectedKey}
          onChange={(e) => handleSelectModule(e.target.value)}
          className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
        >
          {modules.map((mod) => (
            <option key={mod.key} value={mod.key}>
              {mod.name}
              {drafts[mod.key]?.dirty ? " · sin guardar" : ""}
            </option>
          ))}
        </select>
      </label>

      {selectedModule && selectedDraft && (
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{selectedModule.flowLabel}</p>
              <p className="text-xs text-slate-600 mt-1">{selectedModule.description}</p>
            </div>
            {selectedDraft.dirty && (
              <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                Sin guardar
              </span>
            )}
          </div>

          <textarea
            value={selectedDraft.content}
            onChange={(e) => updateDraft(selectedModule.key, e.target.value)}
            disabled={savingKey === selectedModule.key}
            className="w-full h-80 p-4 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 resize-y text-sm bg-slate-50/50 font-mono"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleDownload(selectedModule)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Descargar
              </button>
              <button
                type="button"
                onClick={() => handleCopy(selectedModule.key)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ClipboardCopy className="h-4 w-4" />
                Copiar
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleSave(selectedModule.key)}
              disabled={savingKey === selectedModule.key || !selectedDraft.dirty}
              className="inline-flex items-center gap-2 bg-violet-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:bg-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingKey === selectedModule.key ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar cambios
                </>
              )}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Última actualización: {new Date(selectedModule.updatedAt).toLocaleString("es-AR")}
          </p>
        </div>
      )}
    </div>
  );
}
