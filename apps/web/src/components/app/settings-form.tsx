"use client";

import { CheckCircle, CircleNotch } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "../ui/button";

export interface SettingsValue {
  autoMigrate: boolean;
  autoMigrateIntervalDays: number;
  ignore: string[];
  maxOpenPrs: number;
  proposals: number;
}

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <p id={`${id}-hint`} className="text-xs text-ink-muted">
        {hint}
      </p>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="mt-2 h-11 w-28 rounded-xl border border-border bg-surface px-3 font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--focus)]/40"
      />
    </div>
  );
}

/** Edits `.github/themis.yml`; saving opens a pull request in the repository. */
export function SettingsForm({
  repository,
  initial,
  canWrite,
}: {
  repository: string;
  initial: SettingsValue;
  canWrite: boolean;
}) {
  const [v, setV] = useState(initial);
  const [ignoreText, setIgnoreText] = useState(initial.ignore.join("\n"));
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [result, setResult] = useState("");
  const set = <K extends keyof SettingsValue>(k: K, val: SettingsValue[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const config = {
      ...v,
      ignore: ignoreText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository, config }),
    }).catch(() => undefined);
    const body = (await res?.json().catch(() => ({}))) as { url?: string; error?: string } | undefined;
    if (res?.ok && body?.url) {
      setState("done");
      setResult(body.url);
    } else {
      setState("error");
      setResult(body?.error ?? "Could not save the settings.");
    }
  };

  return (
    <form onSubmit={save} className="grid gap-7">
      <fieldset disabled={!canWrite || state === "busy"} className="grid gap-7">
        <div className="flex items-start justify-between gap-6 rounded-2xl bg-surface-2 p-4">
          <div>
            <label htmlFor="autoMigrate" className="text-sm font-semibold">
              Migrate automatically
            </label>
            <p className="text-xs text-ink-muted">
              After each scan, migrate the top candidate without waiting for a comment. Off by default.
            </p>
          </div>
          <input
            id="autoMigrate"
            type="checkbox"
            role="switch"
            checked={v.autoMigrate}
            onChange={(e) => set("autoMigrate", e.target.checked)}
            className="mt-1 size-5 accent-[var(--primary)]"
          />
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          <NumberField
            id="proposals"
            label="Proposals per scan"
            hint="Issues opened, one per candidate."
            value={v.proposals}
            min={0}
            max={10}
            onChange={(n) => set("proposals", n)}
          />
          <NumberField
            id="maxOpenPrs"
            label="Open PR limit"
            hint="Themis PRs open at once."
            value={v.maxOpenPrs}
            min={1}
            max={10}
            onChange={(n) => set("maxOpenPrs", n)}
          />
          <NumberField
            id="interval"
            label="Days between auto runs"
            hint="Only used when automatic."
            value={v.autoMigrateIntervalDays}
            min={1}
            max={365}
            onChange={(n) => set("autoMigrateIntervalDays", n)}
          />
        </div>
        <div>
          <label htmlFor="ignore" className="text-sm font-semibold">
            Never propose
          </label>
          <p id="ignore-hint" className="text-xs text-ink-muted">
            One package per line.
          </p>
          <textarea
            id="ignore"
            rows={4}
            value={ignoreText}
            aria-describedby="ignore-hint"
            onChange={(e) => setIgnoreText(e.target.value)}
            className="mt-2 w-full rounded-xl border border-border bg-surface p-3 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--focus)]/40"
          />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canWrite || state === "busy"}>
          {state === "busy" ? <CircleNotch size={15} className="animate-spin" aria-hidden="true" /> : null}
          Save as pull request
        </Button>
        {!canWrite ? (
          <span className="text-sm text-ink-muted">You need write access to change settings.</span>
        ) : null}
        {state === "done" ? (
          <a
            href={result}
            target="_blank"
            rel="noreferrer"
            role="status"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--tag-executed)] hover:underline"
          >
            <CheckCircle size={16} weight="fill" aria-hidden="true" />
            Pull request opened. Merge it to apply.
          </a>
        ) : null}
        {state === "error" ? (
          <span role="alert" className="text-sm text-danger">
            {result}
          </span>
        ) : null}
      </div>
    </form>
  );
}
