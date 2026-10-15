"use client";

import { Tiko } from "@/components/tiko";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <div className="flex flex-col items-center gap-4">
        <Tiko mood="think" size={110} />
        <h1 className="text-2xl font-bold tracking-tight">Something went wrong talking to GitHub</h1>
        <p className="max-w-[46ch] text-ink-muted">
          It is usually a rate limit or a short outage. Try again in a moment.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
