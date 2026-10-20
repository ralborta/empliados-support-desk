"use client";

import { useEffect, useRef } from "react";

/**
 * Ejecuta `fn` cada `intervalMs`.
 * Por defecto solo si la pestaña está visible.
 * Con `requireVisible=false` sigue mientras la página esté abierta (aunque esté atrás).
 */
export function usePollWhenVisible(
  fn: () => void,
  intervalMs: number,
  enabled = true,
  requireVisible = true,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    const shouldRun = () => !requireVisible || document.visibilityState === "visible";

    const tick = () => {
      if (shouldRun()) fnRef.current();
    };

    tick();
    const id = window.setInterval(tick, intervalMs);

    const onVisibility = () => {
      if (shouldRun()) fnRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onPageHide = () => {
      if (!requireVisible) fnRef.current();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enabled, intervalMs, requireVisible]);
}
