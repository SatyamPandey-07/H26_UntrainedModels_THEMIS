"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads GitHub while the tab is visible, so new issues, pull requests and runs show up without a reload.
 * Server components re-render in place; scroll position and client state are kept.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = window.setInterval(tick, seconds * 1000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", tick);
    };
  }, [router, seconds]);
  return null;
}
