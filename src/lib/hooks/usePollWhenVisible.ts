"use client";

import { useEffect, useRef } from "react";

/** Ejecuta `fn` cada `intervalMs` mientras la pestaña esté visible. */
export function usePollWhenVisible(fn: () => void, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === "visible") {
        fnRef.current();
      }
    };

    tick();
    const id = window.setInterval(tick, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") fnRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs]);
}
