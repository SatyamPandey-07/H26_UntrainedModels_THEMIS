import { Terminal } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Claude Code plugin" };

const steps = [
  {
    title: "Add the marketplace and install",
    code: "/plugin marketplace add SatyamPandey-07/H26_UntrainedModels_THEMIS\n/plugin install themis@themis",
  },
  { title: "Find the riskiest dependency", code: "/themis" },
  { title: "Migrate it with evidence", code: "/themis migrate svix" },
];

export default function Plugin() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Claude Code plugin</h1>
        <p className="mt-1 max-w-[60ch] text-sm text-ink-muted">
          The same pipeline on your machine. Claude Code plays every agent, so no API key is needed. The
          capsule and evidence rules are identical to the GitHub App.
        </p>
      </header>
      <ol className="grid gap-4">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Card className="p-6">
              <h2 className="flex items-center gap-3 font-bold">
                <span className="grid size-8 place-items-center rounded-full bg-accent font-mono text-sm text-accent-ink">
                  {i + 1}
                </span>
                {s.title}
              </h2>
              <pre className="mt-4 overflow-x-auto rounded-2xl bg-primary-strong p-4 font-mono text-sm text-accent dark:bg-[#2a1f63]">
                <Terminal size={14} className="mb-2 opacity-60" aria-hidden="true" />
                {s.code}
              </pre>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
