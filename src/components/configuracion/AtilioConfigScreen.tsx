"use client";

import { useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileText,
  History,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import AgentConfig from "@/components/configuracion/AgentConfig";
import KnowledgeFilesList from "@/components/configuracion/KnowledgeFilesList";
import ModulePromptsPanel from "@/components/configuracion/ModulePromptsPanel";
import {
  AtilioConfigProvider,
  previewGreeting,
  useAtilioConfig,
} from "@/components/configuracion/AtilioConfigContext";

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "hace un momento";
  if (minutes === 1) return "hace 1 min";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "hace 1 h" : `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

export function AtilioConfigScreen() {
  return (
    <AtilioConfigProvider>
      <AtilioConfigScreenInner />
    </AtilioConfigProvider>
  );
}

function AtilioConfigScreenInner() {
  const {
    isDirty,
    isSaving,
    isLoading,
    message,
    autosavedAt,
    lastPublishedAt,
    knowledgeCount,
    setKnowledgeCount,
    handleSave,
    restoreConfirmOpen,
    setRestoreConfirmOpen,
    confirmRestoreLocalBackup,
  } = useAtilioConfig();

  const savedLabel = autosavedAt || lastPublishedAt;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Configuración de Atilio</h1>
          <p className="text-sm text-slate-500">Tono, documentos de ayuda y textos por trámite.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {message ? (
            <span
              className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                message.type === "success" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {message.text}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {isDirty && autosavedAt
                ? `Borrador guardado ${formatRelative(autosavedAt)}`
                : savedLabel
                  ? "Guardado automáticamente"
                  : "Sin cambios pendientes"}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isLoading || !isDirty}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Publicar cambios
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Conversación general</h2>
            <p className="mb-4 text-xs text-slate-500">
              Definí el saludo, el tono y el estilo de las respuestas. Las reglas base quedan protegidas.
            </p>
            <AgentConfig />
          </section>

          <section
            id="documentos-ayuda"
            className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Documentos de ayuda</h2>
            <p className="mb-4 text-xs text-slate-500">
              Subí PDFs de guía para los módulos informativos. Convención:{" "}
              <span className="font-medium text-slate-600">unidades-modulo-flota.pdf</span>
            </p>
            <KnowledgeFilesList embedded onCountChange={setKnowledgeCount} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Prompts por trámite</h2>
            <p className="mb-4 text-xs text-slate-500">
              Cada trámite tiene su propio texto. Elegí cuál querés editar.
            </p>
            <ModulePromptsPanel embedded />
          </section>
        </div>

        <AtilioConfigSidebar />
      </div>

      <ConfirmDialog
        open={restoreConfirmOpen}
        title="Recuperar respaldo local"
        description="¿Recuperar el respaldo local? Se reemplaza lo que ves en pantalla hasta que publiques los cambios."
        confirmLabel="Recuperar"
        cancelLabel="Cancelar"
        variant="default"
        onConfirm={confirmRestoreLocalBackup}
        onCancel={() => setRestoreConfirmOpen(false)}
      />
    </div>
  );
}

function AtilioConfigSidebar() {
  const {
    prompt,
    fullPrompt,
    knowledgeCount,
    lastPublishedAt,
    autosavedAt,
    localBackupAt,
    history,
    handleDownloadEditablePrompt,
    handleDownloadFinalPrompt,
    handleCopyFinalPrompt,
    handleSaveLocalBackup,
    handleRestoreLocalBackup,
  } = useAtilioConfig();
  const [historyOpen, setHistoryOpen] = useState(false);

  const greeting = previewGreeting(prompt);
  const visibleHistory = historyOpen ? history : history.slice(0, 4);

  return (
    <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Vista previa</h3>
        <div className="rounded-xl bg-slate-100 p-3">
          <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm text-slate-800 shadow-sm">
            {greeting}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Base de conocimiento</h3>
        <p className="text-sm text-slate-600">
          {knowledgeCount} {knowledgeCount === 1 ? "documento" : "documentos"}
        </p>
        <button
          type="button"
          onClick={() => document.getElementById("documentos-ayuda")?.scrollIntoView({ behavior: "smooth" })}
          className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Ir a Documentos
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Último guardado</h3>
        <p className="text-sm text-slate-700">{formatDateTime(lastPublishedAt || autosavedAt)}</p>
        <p className="mt-1 text-xs text-emerald-700">
          {lastPublishedAt ? "Publicado en BuilderBot" : "Guardado automáticamente"}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Historial de cambios</h3>
        {visibleHistory.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay cambios registrados en este navegador.</p>
        ) : (
          <ol className="space-y-3">
            {visibleHistory.map((item, idx) => (
              <li key={`${item.at}-${idx}`} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                <div>
                  <p className="text-sm font-medium text-slate-800">{item.label}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(item.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {history.length > 4 && (
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-900"
          >
            <History className="h-3.5 w-3.5" />
            {historyOpen ? "Ver menos" : "Ver todo el historial"}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Exportar y copiar</h3>
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleDownloadEditablePrompt}
            className="inline-flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Descargar texto editable
          </button>
          <button
            type="button"
            onClick={handleDownloadFinalPrompt}
            disabled={!fullPrompt}
            className="inline-flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            Descargar texto completo
          </button>
          <button
            type="button"
            onClick={() => void handleCopyFinalPrompt()}
            disabled={!fullPrompt}
            className="inline-flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ClipboardCopy className="h-4 w-4" />
            Copiar texto completo
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
        <h3 className="mb-1 text-sm font-semibold text-amber-950">Respaldo local</h3>
        {localBackupAt && (
          <p className="mb-3 text-xs text-amber-900/80">
            Último respaldo: <span className="font-mono">{formatDateTime(localBackupAt)}</span>
          </p>
        )}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleSaveLocalBackup}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-50"
          >
            <Archive className="h-4 w-4" />
            Guardar respaldo local
          </button>
          <button
            type="button"
            onClick={handleRestoreLocalBackup}
            disabled={!localBackupAt}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Recuperar respaldo local
          </button>
        </div>
      </section>
    </aside>
  );
}
