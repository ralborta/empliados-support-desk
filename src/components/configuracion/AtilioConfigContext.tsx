"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const LOCAL_BACKUP_KEY = "empliados-support-desk:agent-prompt-local-backup:v1";
const HISTORY_KEY = "empliados-support-desk:atilio-config-history:v1";
const DRAFT_KEY = "empliados-support-desk:agent-prompt-autosave:v1";
const LAST_PUB_KEY = "empliados-support-desk:agent-prompt-last-published:v1";

type LocalPromptBackupV1 = {
  v: 1;
  savedAt: string;
  editable: string;
  fullContent: string;
  usesTemplate: boolean;
};

export type ConfigHistoryItem = {
  at: string;
  label: string;
};

type Message = { type: "success" | "error"; text: string } | null;

type AtilioConfigContextValue = {
  prompt: string;
  setPrompt: (value: string) => void;
  fullPrompt: string;
  usesTemplate: boolean;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  message: Message;
  localBackupAt: string | null;
  lastPublishedAt: string | null;
  autosavedAt: string | null;
  history: ConfigHistoryItem[];
  knowledgeCount: number;
  setKnowledgeCount: (n: number) => void;
  restoreConfirmOpen: boolean;
  setRestoreConfirmOpen: (open: boolean) => void;
  handleSave: () => Promise<void>;
  handleDownloadEditablePrompt: () => void;
  handleDownloadFinalPrompt: () => void;
  handleCopyFinalPrompt: () => Promise<void>;
  handleSaveLocalBackup: () => void;
  handleRestoreLocalBackup: () => void;
  confirmRestoreLocalBackup: () => void;
};

const AtilioConfigContext = createContext<AtilioConfigContextValue | null>(null);

export function useAtilioConfig() {
  const ctx = useContext(AtilioConfigContext);
  if (!ctx) throw new Error("useAtilioConfig must be used within AtilioConfigProvider");
  return ctx;
}

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

function readHistory(): ConfigHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as ConfigHistoryItem[];
    return Array.isArray(data) ? data.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function pushHistory(label: string): ConfigHistoryItem[] {
  const next = [{ at: new Date().toISOString(), label }, ...readHistory()].slice(0, 12);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

function downloadBackup(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AtilioConfigProvider({ children }: { children: ReactNode }) {
  const [prompt, setPromptState] = useState("");
  const [publishedPrompt, setPublishedPrompt] = useState("");
  const [fullPrompt, setFullPrompt] = useState("");
  const [usesTemplate, setUsesTemplate] = useState(false);
  const [localBackupAt, setLocalBackupAt] = useState<string | null>(null);
  const [lastPublishedAt, setLastPublishedAt] = useState<string | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<ConfigHistoryItem[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((next: Message, ms = 3500) => {
    setMessage(next);
    if (next) window.setTimeout(() => setMessage(null), ms);
  }, []);

  const refreshLocalBackupMeta = useCallback(() => {
    const b = readLocalBackup();
    setLocalBackupAt(b?.savedAt ?? null);
  }, []);

  useEffect(() => {
    refreshLocalBackupMeta();
    setHistory(readHistory());
    try {
      const last = localStorage.getItem(LAST_PUB_KEY);
      if (last) setLastPublishedAt(last);
    } catch {
      /* ignore */
    }
  }, [refreshLocalBackupMeta]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/builderbot/prompt");
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err?.error || "No se pudo cargar el prompt");
        }
        const data = await response.json();
        if (cancelled) return;
        setPromptState(data.content || "");
        setPublishedPrompt(data.content || "");
        setFullPrompt(data.fullContent || "");
        setUsesTemplate(!!data.usesTemplate);
      } catch (error) {
        if (!cancelled) {
          flash({
            type: "error",
            text: error instanceof Error ? error.message : "No se pudo cargar el prompt",
          });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flash]);

  const setPrompt = useCallback((value: string) => {
    setPromptState(value);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), content: value }));
        setAutosavedAt(new Date().toISOString());
      } catch {
        /* ignore */
      }
    }, 1200);
  }, []);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/builderbot/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: prompt, existingFullContent: fullPrompt }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "No se pudo guardar");
      }
      const data = await response.json();
      setFullPrompt(data.fullContent || "");
      setPublishedPrompt(prompt);
      setUsesTemplate(!!data.usesTemplate);
      const now = new Date().toISOString();
      setLastPublishedAt(now);
      try {
        localStorage.setItem(LAST_PUB_KEY, now);
      } catch {
        /* ignore */
      }
      setHistory(pushHistory("Conversación general publicada"));
      flash({ type: "success", text: "Cambios publicados" });
    } catch (error) {
      flash(
        {
          type: "error",
          text: error instanceof Error ? error.message : "No se pudo guardar, intenta nuevamente",
        },
        5000,
      );
    } finally {
      setIsSaving(false);
    }
  }, [flash, fullPrompt, prompt]);

  const handleDownloadFinalPrompt = useCallback(() => {
    if (!fullPrompt) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBackup(fullPrompt, `prompt-final-${stamp}.txt`);
  }, [fullPrompt]);

  const handleDownloadEditablePrompt = useCallback(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBackup(prompt || "", `prompt-editable-${stamp}.txt`);
  }, [prompt]);

  const handleCopyFinalPrompt = useCallback(async () => {
    if (!fullPrompt) return;
    try {
      await navigator.clipboard.writeText(fullPrompt);
      flash({ type: "success", text: "Texto completo copiado al portapapeles" }, 2500);
    } catch {
      flash({ type: "error", text: "No se pudo copiar al portapapeles" }, 4000);
    }
  }, [flash, fullPrompt]);

  const handleSaveLocalBackup = useCallback(() => {
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
      setHistory(pushHistory("Respaldo local guardado"));
      flash({ type: "success", text: "Respaldo guardado en este navegador." }, 4000);
    } catch {
      flash(
        {
          type: "error",
          text: "No se pudo guardar el respaldo local (p. ej. almacenamiento lleno o privado).",
        },
        5000,
      );
    }
  }, [flash, fullPrompt, prompt, refreshLocalBackupMeta, usesTemplate]);

  const handleRestoreLocalBackup = useCallback(() => {
    const b = readLocalBackup();
    if (!b) {
      flash({ type: "error", text: "No hay respaldo local en este navegador." }, 4000);
      return;
    }
    setRestoreConfirmOpen(true);
  }, [flash]);

  const confirmRestoreLocalBackup = useCallback(() => {
    const b = readLocalBackup();
    if (!b) {
      setRestoreConfirmOpen(false);
      flash({ type: "error", text: "No hay respaldo local en este navegador." }, 4000);
      return;
    }
    setPromptState(b.editable);
    setFullPrompt(b.fullContent);
    setUsesTemplate(b.usesTemplate);
    setRestoreConfirmOpen(false);
    setHistory(pushHistory("Respaldo local recuperado"));
    flash({
      type: "success",
      text: "Respaldo recuperado. Revisá el texto y pulsá Publicar cambios cuando esté listo.",
    }, 5000);
  }, [flash]);

  const value = useMemo(
    () => ({
      prompt,
      setPrompt,
      fullPrompt,
      usesTemplate,
      isDirty: prompt !== publishedPrompt,
      isLoading,
      isSaving,
      message,
      localBackupAt,
      lastPublishedAt,
      autosavedAt,
      history,
      knowledgeCount,
      setKnowledgeCount,
      restoreConfirmOpen,
      setRestoreConfirmOpen,
      handleSave,
      handleDownloadEditablePrompt,
      handleDownloadFinalPrompt,
      handleCopyFinalPrompt,
      handleSaveLocalBackup,
      handleRestoreLocalBackup,
      confirmRestoreLocalBackup,
    }),
    [
      autosavedAt,
      confirmRestoreLocalBackup,
      fullPrompt,
      handleCopyFinalPrompt,
      handleDownloadEditablePrompt,
      handleDownloadFinalPrompt,
      handleRestoreLocalBackup,
      handleSave,
      handleSaveLocalBackup,
      history,
      isLoading,
      isSaving,
      knowledgeCount,
      lastPublishedAt,
      localBackupAt,
      message,
      prompt,
      publishedPrompt,
      restoreConfirmOpen,
      setPrompt,
      usesTemplate,
    ],
  );

  return <AtilioConfigContext.Provider value={value}>{children}</AtilioConfigContext.Provider>;
}

export function previewGreeting(prompt: string): string {
  const line = prompt
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .find((l) => l.length > 12 && l.length < 180 && /hola|atilio|ayud/i.test(l));
  return line || "¡Hola! Soy Atilio, tu asistente. ¿En qué puedo ayudarte hoy?";
}
