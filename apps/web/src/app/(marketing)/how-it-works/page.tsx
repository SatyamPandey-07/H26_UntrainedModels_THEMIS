import type { Metadata } from "next";
import { AgentTimeline } from "@/components/agent-timeline";
import { Reveal } from "@/components/reveal";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How it works",
  description: "Six agents, each its own GitHub Actions job, from scan to draft pull request.",
};

const demoJobs = [
  { name: "Prepare · target (read-only)", status: "completed", conclusion: "success" },
  { name: "Argus · Scout", status: "completed", conclusion: "success" },
  { name: "Athena · Planner", status: "completed", conclusion: "success" },
  { name: "Hephaestus · Migrator", status: "completed", conclusion: "success" },
  { name: "Minos · baseline sandbox", status: "completed", conclusion: "success" },
  { name: "Minos · candidate sandbox", status: "completed", conclusion: "success" },
  { name: "Minos · Verdict", status: "completed", conclusion: "success" },
  { name: "Clio · Capsule writer", status: "completed", conclusion: "success" },
  { name: "Publish · draft PR and check run", status: "completed", conclusion: "success" },
];

const steps = [
  {
    title: "Install",
    text: "Choose repositories when you install the GitHub App. Themis scans each one and opens a Dependency Dashboard.",
  },
  {
    title: "Propose",
    text: "One issue per migration candidate, with the risk broken down and the files it touches. Nothing changes yet.",
  },
  {
    title: "Plan",
    text: "Comment /themis plan. Athena maps every usage and replies with the commits it would make.",
  },
  {
    title: "Migrate",
    text: "Comment /themis migrate. Hephaestus works on its own branch; Minos builds both branches side by side.",
  },
  {
    title: "Decide",
    text: "A draft pull request arrives with the capsule. Review it, mark it ready, merge it yourself.",
  },
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 md:px-6">
      <Reveal>
        <h1 className="max-w-[20ch] text-4xl font-extrabold tracking-tight md:text-5xl">
          From scan to draft pull request
        </h1>
        <p className="mt-5 max-w-[60ch] text-lg text-ink-muted">
          Hermes, the orchestrator, runs each agent as its own GitHub Actions job and hands its state to the
          next one.
        </p>
      </Reveal>
      <div className="mt-12">
        <AgentTimeline
          jobs={demoJobs.map((j, i) => ({
            ...j,
            id: i,
            startedAt: null,
            completedAt: null,
            url: "#",
            steps: [],
          }))}
        />
      </div>
      <ol className="mt-20 grid gap-4 md:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-[20px] border border-border bg-surface p-5">
            <span className="grid size-8 place-items-center rounded-full bg-accent font-mono text-sm font-bold text-accent-ink">
              {i + 1}
            </span>
            <h2 className="mt-4 font-bold">{s.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-14 flex justify-center">
        <ButtonLink href="/capsule/sample" size="lg">
          See a sample capsule
        </ButtonLink>
      </div>
    </div>
  );
}
