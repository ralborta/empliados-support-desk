"use client";

import { useRouter, usePathname } from "next/navigation";
import { usePollWhenVisible } from "@/lib/hooks/usePollWhenVisible";

type PanelLiveSyncProps = {
  userRole?: string | null;
};

/**
 * Heartbeat de presencia (soporte + admin, para el monitor externo) + refresh suave de
 * listas del panel. El heartbeat sigue mientras Kira esté abierta, aunque la pestaña
 * no esté visible. El refresh de listas sí espera a que esté en pantalla.
 * El heartbeat en sí sigue siendo SUPPORT-only para el reparto de casos
 * (ver advisorHeartbeat en @/lib/advisorDistribution); para ADMIN solo actualiza
 * presencia (recordAdminPresence), sin tocar nada de cola/asignación.
 */
export function PanelLiveSync({ userRole }: PanelLiveSyncProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isSupport = userRole === "SUPPORT";
  const isAdmin = userRole === "ADMIN";
  const tracksPresence = isSupport || isAdmin;

  usePollWhenVisible(
    () => {
      if (!tracksPresence) return;
      void fetch("/api/advisor/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPage: pathname }),
        keepalive: true,
      }).catch(() => undefined);
    },
    30_000,
    tracksPresence,
    false,
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
