"use client";

import { X } from "@phosphor-icons/react";
import type { Config, DriveStep } from "driver.js";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { buttonClass } from "./ui/button";
import { Tiko, type TikoMood } from "./tiko";

export interface TourStep {
  /** CSS selector of the element Tiko points at. */
  element: string;
  title: string;
  body: string;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: the guide simply shows again next time
  }
}

/**
 * Tiko's corner dock: a speech bubble with one tip and an optional guided tour (driver.js) that highlights each
 * element in turn. Dismissible, remembered per browser, and announced politely to screen readers.
 */
export function TikoGuide({
  id,
  message,
  mood = "wave",
  tour,
  tourLabel = "Show me around",
}: {
  id: string;
  message: string;
  mood?: TikoMood;
  tour?: TourStep[];
  tourLabel?: string;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [currentMood, setMood] = useState<TikoMood>(mood);
  const [bubble, setBubble] = useState(message);

  useEffect(() => {
    setOpen(storageGet(`themis-guide-${id}`) !== "dismissed");
  }, [id]);

  const dismiss = useCallback(() => {
    storageSet(`themis-guide-${id}`, "dismissed");
    setOpen(false);
  }, [id]);

  const startTour = useCallback(async () => {
    if (!tour?.length) return;
    const { driver } = await import("driver.js");
    const steps: DriveStep[] = tour
      .filter((s) => document.querySelector(s.element))
      .map((s) => ({ element: s.element, popover: { title: s.title, description: s.body } }));
    const config: Config = {
      steps,
      popoverClass: "themis-tour",
      showProgress: true,
      animate: !reduce,
      overlayColor: "rgb(27 22 64 / 0.55)",
      stagePadding: 8,
      stageRadius: 16,
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      onHighlightStarted: () => setMood("point"),
      onDestroyed: () => {
        setMood("cheer");
        setBubble("That's the tour. I'm here if you need me.");
        window.setTimeout(() => setMood("idle"), 2400);
      },
    };
    setMood("point");
    driver(config).drive();
  }, [tour, reduce]);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex items-end gap-3">
      <AnimatePresence>
        {open ? (
          <motion.div
            key="bubble"
            initial={reduce ? false : { opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="pointer-events-auto relative mb-6 max-w-[280px] rounded-[20px] border border-border bg-surface p-4 pr-9 text-sm shadow-[var(--shadow)]"
          >
            <p aria-live="polite" className="leading-relaxed">
              {bubble}
            </p>
            {tour?.length ? (
              <button type="button" onClick={startTour} className={buttonClass("primary", "sm", "mt-3")}>
                {tourLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Hide Tiko's tips"
              className="absolute right-2 top-2 rounded-full p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <X size={14} weight="bold" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setMood("wave");
          setBubble(message);
        }}
        aria-label={open ? "Hide Tiko" : "Ask Tiko for help"}
        className="pointer-events-auto rounded-full transition-transform active:scale-95"
      >
        <Tiko mood={currentMood} size={76} />
      </button>
    </div>
  );
}
