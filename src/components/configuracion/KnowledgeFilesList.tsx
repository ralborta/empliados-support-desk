"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, Trash2, Loader2, FileText, AlertCircle, FolderOpen } from "lucide-react";

interface BuilderbotFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
}

export default function KnowledgeFilesList() {
  const [files, setFiles] = useState<BuilderbotFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    setIsLoadingFiles(true);
    setError(null);
    try {
      const response = await fetch("/api/builderbot/files");
      const data = await response.json();
      setFiles(data.files || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los archivos");
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("El archivo es demasiado grande. Máximo 10MB");
      setTimeout(() => setError(null), 5000);
      e.target.value = "";
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/builderbot/files", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "No se pudo subir el archivo");
      }

      await loadFiles();
      e.target.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el archivo");
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar este archivo?")) return;

    setDeletingIds((prev) => new Set(prev).add(id));
    setError(null);

    try {
      const response = await fetch(`/api/builderbot/files?id=${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("No se pudo eliminar el archivo");
      }

      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el archivo");
      setTimeout(() => setError(null), 5000);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString("es-ES", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "Fecha desconocida";
    }
  };

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
          <FolderOpen className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Base de Conocimiento</h2>
          <p className="text-sm text-slate-500 mt-0.5">Gestiona los archivos que alimentan tu asistente</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 text-red-700 border border-red-200 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-semibold">{error}</span>
        </div>
      )}

      {/* Botón de Subir Archivo */}
      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          id="file-upload"
          onChange={handleFileSelect}
          className="hidden"
          accept=".pdf,.txt,.doc,.docx,.md"
          disabled={isUploading}
        />
        <label
          htmlFor="file-upload"
          className={`group flex items-center justify-center gap-3 w-full border-2 border-dashed rounded-xl p-6 cursor-pointer transition-all ${
            isUploading
              ? "border-slate-300 bg-slate-50 cursor-not-allowed"
              : "border-indigo-300 bg-indigo-50 hover:border-indigo-500 hover:bg-indigo-100"
          }`}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />
              <span className="text-slate-700 font-semibold">Subiendo archivo...</span>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center">
                <Upload className="w-5 h-5 text-white" />
              </div>
              <div className="text-center">
                <span className="text-slate-700 font-semibold block">Subir Archivo</span>
                <span className="text-xs text-slate-500 mt-1">PDF, TXT, DOC, DOCX, MD (máx. 10MB)</span>
              </div>
            </>
          )}
        </label>
      </div>

      {/* Lista de Archivos */}
      <div className="space-y-3">
        {isLoadingFiles ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
            <span className="ml-3 text-slate-600">Cargando archivos...</span>
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <FileText className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-slate-600 font-medium mb-1">No hay archivos subidos</p>
            <p className="text-sm text-slate-500">Sube archivos para alimentar la base de conocimiento</p>
          </div>
        ) : (
          files.map((file) => {
            const isDeleting = deletingIds.has(file.id);
            return (
              <div
                key={file.id}
                className="group flex items-center justify-between p-4 border-2 border-slate-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
                    <FileText className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate mb-1">{file.name}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="px-2 py-0.5 bg-slate-100 rounded-lg font-medium">{formatFileSize(file.size)}</span>
                      <span>•</span>
                      <span>{formatDate(file.uploadedAt)}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(file.id)}
                  disabled={isDeleting}
                  className="ml-4 p-2.5 text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Eliminar archivo"
                >
                  {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
