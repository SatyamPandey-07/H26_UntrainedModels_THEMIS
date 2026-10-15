import {
  ArrowRight,
  ChatCircleDots,
  Eye,
  FileMagnifyingGlass,
  GitBranch,
  GithubLogo,
  Hammer,
  Question,
  Scales,
  Sparkle,
  TerminalWindow,
} from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { Reveal } from "@/components/reveal";
import { HeroCards } from "@/components/site/hero-cards";
import { Tiko } from "@/components/tiko";
import { ButtonLink } from "@/components/ui/button";
import { sampleCapsule, tagCounts } from "@/lib/sample";

const runsOn = [
  { slug: "github", name: "GitHub" },
  { slug: "githubactions", name: "GitHub Actions" },
  { slug: "docker", name: "Docker" },
  { slug: "npm", name: "npm" },
  { slug: "python", name: "Python" },
  { slug: "anthropic", name: "Claude Code by Anthropic" },
];

const pipeline = [
  {
    name: "Argus",
    role: "Scout",
    text: "Detects the toolchain and ranks every direct dependency by risk.",
    Icon: Eye,
  },
  {
    name: "Athena",
    role: "Planner",
    text: "Maps each usage with Opengrep rules and plans the change.",
    Icon: FileMagnifyingGlass,
  },
  {
    name: "Hephaestus",
    role: "Migrator",
    text: "Commits one concern at a time on its own branch.",
    Icon: Hammer,
  },
  {
    name: "Minos",
    role: "Verifier",
    text: "Builds both branches in sandboxes side by side and holds the veto.",
    Icon: Scales,
  },
  {
    name: "Clio",
    role: "Capsule writer",
    text: "Writes the report. Plain code, so no claim is talked into place.",
    Icon: Sparkle,
  },
];

const faqs = [
  {
    q: "Does Themis ever merge or push to my default branch?",
    a: "No. It works on a themis/ branch and opens a draft pull request. Merging is always your call.",
  },
  {
    q: "What does it need from me?",
    a: "Install the GitHub App on the repositories you choose. No workflow file, no secrets, no config.",
  },
  {
    q: "Which ecosystems are supported?",
    a: "npm projects (JavaScript and TypeScript) and Python projects that use pip requirements files.",
  },
  {
    q: "Where does my code run?",
    a: "On GitHub Actions runners. Your project code only runs inside Docker sandboxes with the network cut after install.",
  },
  {
    q: "What happens when a migration is not safe?",
    a: "The capsule says so with the verdict Not recommended and the reasons. That is a valid outcome, not a failure.",
  },
];

export default function Home() {
  const counts = tagCounts(sampleCapsule);
  const to = sampleCapsule.dependency.to?.replace(`${sampleCapsule.dependency.name}@`, "") ?? "";

  return (
    <>
      {/* Hero: asymmetric split, real capsule data on the right. */}
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <Reveal>
          <h1 className="max-w-[16ch] text-4xl font-extrabold leading-[1.05] tracking-tight md:text-5xl lg:text-6xl">
            Dependency upgrades you can actually trust
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-ink-muted">
            Themis finds risky packages, migrates one on its own branch, proves it in a sandbox, and shows the
            evidence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/api/auth/login" size="lg">
              <GithubLogo size={18} weight="bold" aria-hidden="true" />
              Sign in with GitHub
            </ButtonLink>
            <ButtonLink href="/capsule/sample" variant="secondary" size="lg">
              See a sample capsule
              <ArrowRight size={16} aria-hidden="true" />
            </ButtonLink>
          </div>
        </Reveal>
        <HeroCards
          data={{
            dependency: sampleCapsule.dependency.name,
            from: sampleCapsule.dependency.from,
            to,
            verdict: sampleCapsule.verdict,
            repository: sampleCapsule.repository,
            tagCounts: counts,
            claims: sampleCapsule.claims.length,
          }}
        />
      </section>

      {/* Runs on: logo wall under the hero. */}
      <section aria-label="Runs on" className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 rounded-[24px] border border-border bg-surface/70 px-6 py-7">
          {runsOn.map((l) => (
            <Image
              key={l.slug}
              src={`https://cdn.simpleicons.org/${l.slug}/6b6790`}
              alt={l.name}
              width={28}
              height={28}
              unoptimized
              className="opacity-80 dark:invert"
            />
          ))}
        </div>
      </section>

      {/* Pipeline: connected flow, one row on desktop, vertical on mobile. */}
      <section className="mx-auto max-w-7xl px-4 pt-24 md:px-6">
        <Reveal>
          <h2 className="max-w-[22ch] text-3xl font-bold tracking-tight md:text-4xl">
            Five specialists, one pipeline
          </h2>
          <p className="mt-4 max-w-[60ch] text-ink-muted">
            Each agent is its own job on GitHub Actions. You can watch every hand-off live in your dashboard.
          </p>
        </Reveal>
        <div role="list" className="relative mt-12 grid gap-6 md:grid-cols-5 md:gap-4">
          <span
            aria-hidden="true"
            className="absolute left-6 top-6 hidden h-px w-[calc(100%-3rem)] bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10 md:block"
          />
          {pipeline.map((p, i) => (
            <Reveal key={p.name} delay={i * 0.08}>
              <div role="listitem" className="relative flex gap-4 md:flex-col">
                <span className="relative z-10 grid size-12 shrink-0 place-items-center rounded-2xl border border-border bg-surface text-primary shadow-[var(--shadow)]">
                  <p.Icon size={22} weight="duotone" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-bold">
                    {p.name} <span className="font-medium text-ink-muted">{p.role}</span>
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{p.text}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Provenance: bento with four different surfaces. */}
      <section className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
        <Reveal>
          <h2 className="max-w-[24ch] text-3xl font-bold tracking-tight md:text-4xl">
            Every claim says how it was established
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-6">
          <Reveal className="md:col-span-4">
            <div className="h-full rounded-[24px] bg-primary-strong p-7 text-white dark:bg-[#2a1f63]">
              <TerminalWindow size={28} weight="duotone" className="text-accent" aria-hidden="true" />
              <h3 className="mt-6 text-2xl font-bold">Executed</h3>
              <p className="mt-2 max-w-[48ch] text-white/75">
                A command ran in a sandbox. The exact command, its exit code and its log file are attached. No
                log, no Executed tag.
              </p>
              <p className="mt-6 font-mono text-sm text-accent">
                npm ci · npx jest --ci · exit 0 · logs/3004-baseline-tests.log
              </p>
            </div>
          </Reveal>
          <Reveal className="md:col-span-2" delay={0.08}>
            <div className="h-full rounded-[24px] bg-accent p-7 text-accent-ink">
              <Question size={28} weight="duotone" aria-hidden="true" />
              <h3 className="mt-6 text-2xl font-bold">Unverified</h3>
              <p className="mt-2 opacity-80">Nothing proved it. Listed openly as a gap, never hidden.</p>
            </div>
          </Reveal>
          <Reveal className="md:col-span-3" delay={0.1}>
            <div className="h-full rounded-[24px] border border-border bg-surface p-7">
              <Eye
                size={28}
                weight="duotone"
                className="text-[color:var(--tag-observed)]"
                aria-hidden="true"
              />
              <h3 className="mt-6 text-2xl font-bold">Observed</h3>
              <p className="mt-2 text-ink-muted">
                Read from your repository or a registry, with the file, line or URL cited.
              </p>
            </div>
          </Reveal>
          <Reveal className="md:col-span-3" delay={0.14}>
            <div className="h-full rounded-[24px] bg-primary-soft p-7">
              <Sparkle size={28} weight="duotone" className="text-[color:var(--tag-ai)]" aria-hidden="true" />
              <h3 className="mt-6 text-2xl font-bold">AI-recommended</h3>
              <p className="mt-2 text-ink-muted">
                The model reasoned over observed data. Its name and its inputs are recorded.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Capsule showcase: full-width band with a real result. */}
      <section className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
        <Reveal>
          <div className="grid gap-10 rounded-[28px] border border-border bg-surface p-8 shadow-[var(--shadow)] md:p-12 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">A report you can decide from</h2>
              <p className="mt-4 max-w-[52ch] text-ink-muted">
                The Dependency Exit Capsule travels with the draft pull request: why this package, what
                changed, what was proven against your default branch, and what was not.
              </p>
              <ButtonLink href="/capsule/sample" className="mt-8">
                Read the WorkSphere capsule
                <ArrowRight size={16} aria-hidden="true" />
              </ButtonLink>
            </div>
            <dl className="grid grid-cols-2 gap-4">
              {[
                { k: "Verdict", v: sampleCapsule.verdict },
                {
                  k: "Change",
                  v: `${sampleCapsule.dependency.name} ${sampleCapsule.dependency.from} to ${to}`,
                },
                { k: "Claims recorded", v: String(sampleCapsule.claims.length) },
                { k: "Claims downgraded", v: String(sampleCapsule.downgraded.length) },
              ].map((s) => (
                <div key={s.k} className="rounded-2xl bg-surface-2 p-5">
                  <dt className="text-sm text-ink-muted">{s.k}</dt>
                  <dd className="mt-2 text-lg font-bold [overflow-wrap:anywhere]">{s.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </section>

      {/* Two ways in: GitHub App and Claude Code plugin. */}
      <section
        id="plugin"
        className="mx-auto grid max-w-7xl scroll-mt-24 gap-4 px-4 pt-28 md:grid-cols-2 md:px-6"
      >
        <Reveal>
          <div className="h-full rounded-[24px] border border-border bg-surface p-8">
            <GitBranch size={28} weight="duotone" className="text-primary" aria-hidden="true" />
            <h2 className="mt-6 text-2xl font-bold">For repository owners</h2>
            <p className="mt-2 max-w-[48ch] text-ink-muted">
              Install the GitHub App. Themis opens a Dependency Dashboard and one proposal per candidate.
              Comment{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm">/themis plan</code> or{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm">/themis migrate</code> to
              act.
            </p>
            <ButtonLink href="/api/auth/login" variant="secondary" className="mt-6">
              <GithubLogo size={16} weight="bold" aria-hidden="true" />
              Sign in with GitHub
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="h-full rounded-[24px] bg-primary-strong p-8 text-white dark:bg-[#2a1f63]">
            <ChatCircleDots size={28} weight="duotone" className="text-accent" aria-hidden="true" />
            <h2 className="mt-6 text-2xl font-bold">For developers in Claude Code</h2>
            <p className="mt-2 max-w-[48ch] text-white/75">
              The same pipeline on your machine. Claude Code is the model, so no API key is needed.
            </p>
            <pre className="mt-6 overflow-x-auto rounded-2xl bg-black/25 p-4 font-mono text-sm text-accent">
              {
                "/plugin marketplace add SatyamPandey-07/H26_UntrainedModels_THEMIS\n/plugin install themis@themis"
              }
            </pre>
          </div>
        </Reveal>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pt-28 md:px-6">
        <h2 className="text-3xl font-bold tracking-tight">Questions</h2>
        <div className="mt-8 grid gap-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-border bg-surface px-5 py-4 open:shadow-[var(--shadow)]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}
                <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-ink-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing call to action with Tiko. */}
      <section className="mx-auto max-w-7xl px-4 pt-28 md:px-6">
        <div className="flex flex-col items-center gap-6 rounded-[28px] bg-primary-soft px-6 py-14 text-center">
          <Tiko mood="cheer" size={92} />
          <h2 className="max-w-[20ch] text-3xl font-bold tracking-tight md:text-4xl">
            Let Tiko show you your riskiest dependency
          </h2>
          <ButtonLink href="/api/auth/login" size="lg">
            <GithubLogo size={18} weight="bold" aria-hidden="true" />
            Sign in with GitHub
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
