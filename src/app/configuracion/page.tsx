import { requireAdminSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import KnowledgeFilesList from "@/components/configuracion/KnowledgeFilesList";
import AgentConfig from "@/components/configuracion/AgentConfig";
import ModulePromptsPanel from "@/components/configuracion/ModulePromptsPanel";
import { Brain, FileText, MessageSquare } from "lucide-react";

export default async function ConfiguracionPage() {
  await requireAdminSession();

  return (
    <TicketsLayout showHeader={false}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Configuración</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tono de Atilio, documentos de ayuda y textos por trámite.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Brain className="h-4 w-4 text-violet-600" />
              <h2 className="text-sm font-semibold text-slate-900">Conversación general</h2>
            </div>
            <div className="p-3">
              <AgentConfig />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <FileText className="h-4 w-4 text-violet-600" />
              <h2 className="text-sm font-semibold text-slate-900">Documentos de ayuda (PDF)</h2>
            </div>
            <div className="p-3">
              <KnowledgeFilesList />
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <MessageSquare className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-slate-900">Texto por trámite</h2>
          </div>
          <div className="p-3">
            <ModulePromptsPanel />
          </div>
        </section>
      </div>
    </TicketsLayout>
  );
}
