"use client";

import { useState } from "react";

interface Attachment {
  url: string;
  type: string;
  name: string;
}

const isAbsoluteUrl = (url: string) =>
  url.startsWith("http://") || url.startsWith("https://");

export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {attachments.map((att, idx) => {
          const canLoad = isAbsoluteUrl(att.url);
          if (!canLoad) {
            return (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-amber-800"
              >
                <span className="text-2xl">📎</span>
                <div className="text-left">
                  <div className="text-sm font-medium">{att.name}</div>
                  <div className="text-xs text-amber-600">Archivo no disponible (URL no válida)</div>
                </div>
              </div>
            );
          }
          return (
            <div key={idx}>
              {att.type === "image" ? (
                <button
                  onClick={() => setLightboxUrl(att.url)}
                  className="group relative overflow-hidden rounded-lg border border-slate-200 transition-all hover:border-rose-400"
                >
                  <img
                    src={att.url}
                    alt={att.name}
                    className="h-32 w-32 object-cover transition group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/10">
                    <span className="text-sm font-semibold text-white opacity-0 transition group-hover:opacity-100">
                      🔍 Ver
                    </span>
                  </div>
                </button>
              ) : att.type === "video" ? (
                <video
                  src={att.url}
                  controls
                  className="h-32 rounded-lg border border-slate-200"
                />
              ) : att.type === "audio" ? (
                <div className="flex flex-col gap-1">
                  <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <span>🎤</span>
                    <span>Nota de voz</span>
                  </div>
                  <audio src={att.url} controls className="max-w-[260px] rounded-lg" />
                </div>
              ) : (
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 transition hover:bg-slate-100"
                >
                  <span className="text-2xl">📎</span>
                  <div className="text-left">
                    <div className="text-sm font-medium text-slate-900">{att.name}</div>
                    <div className="text-xs text-slate-500">{att.type}</div>
                  </div>
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white text-4xl hover:text-slate-300 transition"
            onClick={() => setLightboxUrl(null)}
          >
            ×
          </button>
          <img
            src={lightboxUrl}
            alt="Vista completa"
            className="max-h-full max-w-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
