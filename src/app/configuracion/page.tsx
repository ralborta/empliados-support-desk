import { requireAdminSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import KnowledgeFilesList from "@/components/configuracion/KnowledgeFilesList";
import AgentConfig from "@/components/configuracion/AgentConfig";
import ModulePromptsPanel from "@/components/configuracion/ModulePromptsPanel";

export default async function ConfiguracionPage() {
  await requireAdminSession();

  return (
    <TicketsLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">⚙️ Configuración</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configurá cómo responde Atilio: su tono general, los documentos de ayuda y el texto de cada
            trámite.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">
              1 · Conversación general
            </p>
            <AgentConfig />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">
              2 · Documentos de ayuda
            </p>
            <KnowledgeFilesList />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-600">
            3 · Texto por trámite
          </p>
          <ModulePromptsPanel />
        </div>
      </div>
    </TicketsLayout>
  );
}
