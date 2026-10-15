"use client";

import { CheckCircle, CircleNotch } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "../ui/button";

type Mode = "scan" | "plan" | "run";

/** Starts a Themis run from the web app (same path as a `/themis` comment) and reports back inline. */
export function ActionButton({
  repository,
  mode,
  pkg,
  issue,
  label,
  variant = "primary",
  size = "sm",
  onDone,
}: {
  repository: string;
  mode: Mode;
  pkg?: string;
  issue?: number;
  label: string;
  variant?: "primary" | "secondary" | "accent" | "ghost";
  size?: "sm" | "md" | "lg";
  onDone?: () => void;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const start = async () => {
    setState("busy");
    const res = await fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository, mode, package: pkg, issue }),
    }).catch(() => undefined);
    if (res?.ok) {
      setState("done");
      onDone?.();
      setMessage(
        mode === "scan" ? "Scan queued." : mode === "plan" ? "Planning queued." : "Migration queued.",
      );
    } else {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setState("error");
      setMessage(body?.error ?? "Could not start the run.");
    }
  };

  if (state === "done")
    return (
      <span className="inline-flex items-center gap-2 text-sm text-[color:var(--tag-executed)]" role="status">
        <CheckCircle size={16} weight="fill" aria-hidden="true" />
        {message}{" "}
        <Link href={`/runs?repo=${encodeURIComponent(repository)}`} className="font-semibold underline">
          Watch it
        </Link>
      </span>
    );

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant={variant} size={size} onClick={start} disabled={state === "busy"}>
        {state === "busy" ? <CircleNotch size={15} className="animate-spin" aria-hidden="true" /> : null}
        {label}
      </Button>
      {state === "error" ? (
        <span role="alert" className="text-sm text-danger">
          {message}
        </span>
      ) : null}
    </span>
  );
}
