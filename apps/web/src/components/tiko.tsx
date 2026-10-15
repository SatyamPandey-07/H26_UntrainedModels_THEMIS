"use client";

import { motion, useReducedMotion } from "motion/react";

export type TikoMood = "idle" | "wave" | "point" | "think" | "cheer";

/**
 * Tiko, the Themis guide. A small hand-built SVG robot (the brief asked for a custom mascot) animated with Motion.
 * Every mood collapses to a still pose under prefers-reduced-motion.
 */
export function Tiko({
  mood = "idle",
  size = 96,
  className,
}: {
  mood?: TikoMood;
  size?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const still = Boolean(reduce);

  const body = still
    ? {}
    : mood === "cheer"
      ? { y: [0, -10, 0], transition: { duration: 0.6, repeat: Infinity, repeatDelay: 0.4 } }
      : { y: [0, -4, 0], transition: { duration: 3, repeat: Infinity, ease: "easeInOut" as const } };

  const rightArm = still
    ? { rotate: mood === "point" ? -70 : 0 }
    : mood === "wave"
      ? { rotate: [0, -50, -20, -50, 0], transition: { duration: 1.4, repeat: Infinity, repeatDelay: 0.8 } }
      : mood === "point"
        ? { rotate: -70, transition: { type: "spring" as const, stiffness: 120, damping: 14 } }
        : mood === "cheer"
          ? { rotate: -140, transition: { type: "spring" as const, stiffness: 120, damping: 12 } }
          : { rotate: 0 };

  const leftArm = still
    ? {}
    : mood === "cheer"
      ? { rotate: 140, transition: { type: "spring" as const, stiffness: 120, damping: 12 } }
      : { rotate: 0 };

  const eyes = still
    ? {}
    : mood === "think"
      ? { y: -2, x: 2 }
      : { scaleY: [1, 1, 0.1, 1], transition: { duration: 4, repeat: Infinity, times: [0, 0.92, 0.96, 1] } };

  const chest = still
    ? {}
    : { opacity: [0.75, 1, 0.75], transition: { duration: mood === "think" ? 0.8 : 2.4, repeat: Infinity } };

  return (
    <motion.svg
      viewBox="0 0 120 130"
      width={size}
      height={(size * 130) / 120}
      className={className}
      role="img"
      aria-label="Tiko, the Themis guide robot"
      animate={body}
    >
      {/* antenna */}
      <line x1="60" y1="10" x2="60" y2="26" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" />
      <motion.circle
        cx="60"
        cy="9"
        r="6"
        fill="var(--accent)"
        stroke="var(--primary)"
        strokeWidth="3"
        animate={chest}
      />

      {/* left arm */}
      <motion.g style={{ originX: "22px", originY: "78px" }} animate={leftArm}>
        <rect
          x="8"
          y="74"
          width="16"
          height="30"
          rx="8"
          fill="var(--primary-soft)"
          stroke="var(--primary)"
          strokeWidth="3"
        />
      </motion.g>
      {/* right arm */}
      <motion.g style={{ originX: "98px", originY: "78px" }} animate={rightArm}>
        <rect
          x="96"
          y="74"
          width="16"
          height="30"
          rx="8"
          fill="var(--primary-soft)"
          stroke="var(--primary)"
          strokeWidth="3"
        />
      </motion.g>

      {/* body */}
      <rect
        x="24"
        y="66"
        width="72"
        height="50"
        rx="20"
        fill="var(--surface)"
        stroke="var(--primary)"
        strokeWidth="3.5"
      />
      <motion.rect
        x="50"
        y="80"
        width="20"
        height="14"
        rx="7"
        fill="var(--accent)"
        stroke="var(--primary)"
        strokeWidth="2.5"
        animate={chest}
      />

      {/* head */}
      <rect
        x="18"
        y="24"
        width="84"
        height="48"
        rx="24"
        fill="var(--surface)"
        stroke="var(--primary)"
        strokeWidth="3.5"
      />
      <rect x="28" y="33" width="64" height="30" rx="15" fill="var(--primary-strong)" />
      <motion.g style={{ originX: "60px", originY: "48px" }} animate={eyes}>
        {mood === "cheer" ? (
          <>
            <path
              d="M41 50 q6 -8 12 0"
              stroke="var(--accent)"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M67 50 q6 -8 12 0"
              stroke="var(--accent)"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <rect x="42" y="42" width="10" height="13" rx="5" fill="var(--accent)" />
            <rect x="68" y="42" width="10" height="13" rx="5" fill="var(--accent)" />
          </>
        )}
      </motion.g>
      {/* cheeks */}
      <circle cx="34" cy="57" r="3" fill="#f6a5c0" opacity="0.8" />
      <circle cx="86" cy="57" r="3" fill="#f6a5c0" opacity="0.8" />
      {/* feet */}
      <rect x="36" y="114" width="18" height="10" rx="5" fill="var(--primary)" />
      <rect x="66" y="114" width="18" height="10" rx="5" fill="var(--primary)" />
    </motion.svg>
  );
}
