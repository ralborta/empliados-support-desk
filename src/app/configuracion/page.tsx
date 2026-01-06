import { requireSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import KnowledgeFilesList from "@/components/configuracion/KnowledgeFilesList";
import AgentConfig from "@/components/configuracion/AgentConfig";

export default async function ConfiguracionPage() {
  await requireSession();

  return (
    <TicketsLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">⚙️ Configuración</h1>
          <p className="mt-1 text-sm text-slate-500">
            Gestiona la base de conocimientos y configura el comportamiento del agente
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Configuración del Agente */}
          <div>
            <AgentConfig />
          </div>

          {/* Base de Conocimiento */}
          <div>
            <KnowledgeFilesList />
          </div>
        </div>
      </div>
    </TicketsLayout>
  );
}
