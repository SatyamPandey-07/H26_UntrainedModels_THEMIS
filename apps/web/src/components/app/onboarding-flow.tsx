"use client";

import { ArrowRight, CheckCircle, GithubLogo, Lock } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "../ui/button";
import { Tiko, type TikoMood } from "../tiko";
import { ActionButton } from "./action-button";

export interface OnboardingRepo {
  fullName: string;
  private: boolean;
}

const lines: Record<number, { mood: TikoMood; text: string }> = {
  0: {
    mood: "wave",
    text: "Hi, I'm Tiko. I help Themis find the dependency most likely to hurt you, and fix it with proof.",
  },
  1: {
    mood: "point",
    text: "First, let Themis see your repositories. You pick exactly which ones on GitHub.",
  },
  2: {
    mood: "think",
    text: "Pick a repository and I'll start a scan. It runs on our GitHub Actions, not your machine.",
  },
  3: {
    mood: "cheer",
    text: "Scan started. In a few minutes your Dependency Dashboard and proposals will appear.",
  },
};

/** Four-step onboarding with Tiko narrating: hello, install the App, pick a repo, first scan. */
export function OnboardingFlow({
  installUrl,
  repos,
  login,
}: {
  installUrl: string;
  repos: OnboardingRepo[];
  login: string;
}) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(repos.length > 0 ? 2 : 0);
  const [picked, setPicked] = useState<string | undefined>(repos[0]?.fullName);
  const line = lines[step] ?? lines[0]!;

  return (
    <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-[220px_1fr] md:items-start">
      <div className="flex flex-col items-center gap-4 md:sticky md:top-10">
        <Tiko mood={line.mood} size={150} />
        <ol aria-label="Onboarding progress" className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className={`h-2 w-8 rounded-full ${i <= step ? "bg-primary" : "bg-surface-2"}`}>
              <span className="sr-only">
                Step {i + 1}
                {i === step ? " (current)" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-[28px] border border-border bg-surface p-7 shadow-[var(--shadow)] md:p-9">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={reduce ? false : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
            transition={{ duration: 0.25 }}
          >
            <p aria-live="polite" className="text-xl font-semibold leading-snug">
              {line.text}
            </p>

            {step === 0 ? (
              <div className="mt-8">
                <p className="text-ink-muted">
                  Welcome, @{login}. Setup takes about a minute and needs no config files or secrets.
                </p>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className={buttonClass("primary", "lg", "mt-6")}
                >
                  Let's go
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="mt-8">
                <ul className="grid gap-3 text-sm">
                  {[
                    "Reads code and opens issues and draft pull requests",
                    "Never pushes to your default branch, never merges",
                    "Remove it any time from your GitHub settings",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle
                        size={18}
                        weight="fill"
                        className="mt-0.5 shrink-0 text-[color:var(--tag-executed)]"
                        aria-hidden="true"
                      />
                      {t}
                    </li>
                  ))}
                </ul>
                <div className="mt-7 flex flex-wrap gap-3">
                  <a href={installUrl} className={buttonClass("primary", "lg")}>
                    <GithubLogo size={18} weight="bold" aria-hidden="true" />
                    Install on GitHub
                  </a>
                  <Link href="/onboarding" className={buttonClass("ghost", "lg")}>
                    I already installed it
                  </Link>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-8">
                <fieldset>
                  <legend className="text-sm text-ink-muted">Repositories Themis can see</legend>
                  <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto pr-1">
                    {repos.map((r) => (
                      <label
                        key={r.fullName}
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                          picked === r.fullName
                            ? "border-primary bg-primary-soft"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="repo"
                          value={r.fullName}
                          checked={picked === r.fullName}
                          onChange={() => setPicked(r.fullName)}
                          className="accent-[var(--primary)]"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">{r.fullName}</span>
                        {r.private ? (
                          <Lock size={14} className="text-ink-muted" aria-label="Private" />
                        ) : null}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {picked ? (
                    <ActionButton
                      repository={picked}
                      mode="scan"
                      label="Scan this repository"
                      size="lg"
                      onDone={() => setStep(3)}
                    />
                  ) : null}
                  <a href={installUrl} className={buttonClass("ghost", "lg")}>
                    Add more repositories
                  </a>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={`/runs?repo=${encodeURIComponent(picked ?? "")}`}
                  className={buttonClass("primary", "lg")}
                >
                  Watch the agents work
                </Link>
                <Link href="/dashboard" className={buttonClass("secondary", "lg")}>
                  Go to dashboard
                </Link>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
