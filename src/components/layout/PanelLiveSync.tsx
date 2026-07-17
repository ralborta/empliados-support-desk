"use client";

import { useRouter } from "next/navigation";
import { usePollWhenVisible } from "@/lib/hooks/usePollWhenVisible";

type PanelLiveSyncProps = {
  userRole?: string | null;
};

/** Heartbeat de asesores + refresh suave de listas del panel. */
export function PanelLiveSync({ userRole }: PanelLiveSyncProps) {
  const router = useRouter();
  const isSupport = userRole === "SUPPORT";

  usePollWhenVisible(
    () => {
      if (!isSupport) return;
      void fetch("/api/advisor/heartbeat", { method: "POST" }).catch(() => undefined);
    },
    30_000,
    isSupport,
  );

  usePollWhenVisible(
    () => {
      router.refresh();
    },
    15_000,
    true,
  );

  return null;
}
