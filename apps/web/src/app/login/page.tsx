import { GithubLogo, Warning } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { Logo } from "@/components/site/logo";
import { Tiko } from "@/components/tiko";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const href = `/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <main className="page-wash grid min-h-[100dvh] place-items-center px-4">
      <div className="w-full max-w-md rounded-[28px] border border-border bg-surface p-8 text-center shadow-[var(--shadow)]">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="mt-6 flex justify-center">
          <Tiko mood="wave" size={110} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Welcome to Themis</h1>
        <p className="mt-2 text-ink-muted">
          Sign in with GitHub. You choose which repositories Themis can see on the next screen.
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-danger-bg px-4 py-3 text-sm text-danger"
          >
            <Warning size={16} weight="bold" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <a href={href} className={buttonClass("primary", "lg", "mt-7 w-full")}>
          <GithubLogo size={18} weight="bold" aria-hidden="true" />
          Sign in with GitHub
        </a>
        <p className="mt-5 text-xs text-ink-muted">
          Themis reads code only in repositories you install it on, and never merges anything.
        </p>
      </div>
    </main>
  );
}
