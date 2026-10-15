"use client";

import { ArrowRight, CheckCircle, CircleNotch } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Tiko } from "../tiko";
import { TagChip, VerdictChip } from "../ui/chips";

export interface HeroData {
  dependency: string;
  from: string;
  to: string;
  verdict: string;
  repository: string;
  tagCounts: Record<"OBSERVED" | "EXECUTED" | "AI-RECOMMENDED" | "UNVERIFIED", number>;
  claims: number;
}

const agents = [
  { name: "Argus", role: "Scout" },
  { name: "Athena", role: "Planner" },
  { name: "Hephaestus", role: "Migrator" },
  { name: "Minos", role: "Verifier" },
  { name: "Clio", role: "Capsule" },
];

/** Floating cards built from a real capsule (WorkSphere, svix), arranged like the reference board. */
export function HeroCards({ data }: { data: HeroData }) {
  const reduce = useReducedMotion();
  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 24, rotate: 0 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, type: "spring" as const, stiffness: 90, damping: 18 },
        };

  return (
    <div className="relative mx-auto h-[460px] w-full max-w-[560px] md:h-[520px]">
      <motion.div
        {...enter(0.05)}
        className="absolute left-0 top-6 w-[78%] rounded-[22px] border border-border bg-surface p-5 shadow-[var(--shadow)] md:w-[70%]"
      >
        <p className="text-xs text-ink-muted">{data.repository}</p>
        <p className="mt-1 flex items-center gap-2 font-mono text-lg font-bold">
          {data.dependency} <span className="font-normal text-ink-muted">{data.from}</span>
          <ArrowRight size={16} aria-hidden="true" /> {data.to}
        </p>
        <div className="mt-3">
          <VerdictChip verdict={data.verdict} />
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <TagChip tag="OBSERVED" count={data.tagCounts.OBSERVED} />
          <TagChip tag="EXECUTED" count={data.tagCounts.EXECUTED} />
        </div>
      </motion.div>

      <motion.div
        {...enter(0.2)}
        className="absolute right-0 top-[38%] w-[62%] rounded-[22px] bg-primary-strong p-5 text-white shadow-[var(--shadow)] dark:bg-[#2a1f63] md:w-[54%]"
      >
        <p className="text-sm font-semibold text-white/80">Agent run</p>
        <ul className="mt-3 grid gap-2.5">
          {agents.map((a, i) => (
            <li key={a.name} className="flex items-center gap-3 text-sm">
              {i < 4 || reduce ? (
                <CheckCircle size={18} weight="fill" className="text-accent" aria-hidden="true" />
              ) : (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
                  className="grid"
                >
                  <CircleNotch size={18} weight="bold" className="text-accent" aria-hidden="true" />
                </motion.span>
              )}
              <span className="font-semibold">{a.name}</span>
              <span className="text-white/60">{a.role}</span>
            </li>
          ))}
        </ul>
      </motion.div>

      <motion.div
        {...enter(0.35)}
        className="absolute bottom-6 left-[6%] w-[46%] rounded-[22px] bg-accent p-5 text-accent-ink shadow-[var(--shadow)] md:w-[40%]"
      >
        <p className="text-sm font-semibold">Claims with evidence</p>
        <p className="mt-1 font-mono text-4xl font-bold">{data.claims}</p>
        <p className="mt-1 text-xs opacity-80">{data.tagCounts.UNVERIFIED} listed openly as gaps</p>
      </motion.div>

      <motion.div {...enter(0.5)} className="absolute bottom-0 right-[8%]">
        <Tiko mood="wave" size={104} />
      </motion.div>
    </div>
  );
}
