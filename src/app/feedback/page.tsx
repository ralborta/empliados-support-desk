import { requireSession } from "@/lib/auth";
import { TicketsLayout } from "@/components/tickets/TicketsLayout";
import { FeedbackList } from "@/components/feedback/FeedbackList";
import { listServiceFeedback } from "@/lib/kiraServiceFeedbackQuery";
import { MessageSquareHeart } from "lucide-react";

export default async function FeedbackPage() {
  await requireSession();

  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const { rows, avgScore, countWithScore } = await listServiceFeedback({ from, limit: 200 });

  return (
    <TicketsLayout showHeader={false}>
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-[#4a0e1c]/10 p-2 text-[#4a0e1c]">
            <MessageSquareHeart className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Feedback Kira</h1>
            <p className="mt-1 text-sm text-slate-500">
              Notas 1–10 y comentarios al cerrar la consulta. Solo lectura — sin campañas.
            </p>
          </div>
        </div>

        <FeedbackList
          initialRows={rows}
          initialAvg={avgScore}
          initialCount={countWithScore}
        />
      </div>
    </TicketsLayout>
  );
}
