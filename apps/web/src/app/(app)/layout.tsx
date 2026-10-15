import { SignOut } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { AppNav } from "@/components/app/app-nav";
import { Logo } from "@/components/site/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 z-30 flex flex-col gap-4 border-b border-border bg-bg/90 px-3 py-3 backdrop-blur md:h-[100dvh] md:border-b-0 md:border-r md:px-4 md:py-6">
        <div className="flex items-center justify-between px-2">
          <Logo href="/dashboard" />
          <span className="flex items-center md:hidden">
            <ThemeToggle />
            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                aria-label="Sign out"
                className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <SignOut size={18} weight="bold" />
              </button>
            </form>
          </span>
        </div>
        <AppNav />
        <div className="mt-auto hidden items-center gap-3 rounded-2xl border border-border bg-surface p-3 md:flex">
          <Image src={user.avatarUrl} alt="" width={36} height={36} className="rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.name ?? user.login}</p>
            <p className="truncate text-xs text-ink-muted">@{user.login}</p>
          </div>
          <ThemeToggle />
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <SignOut size={18} weight="bold" />
            </button>
          </form>
        </div>
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 px-4 py-6 outline-none md:px-10 md:py-10">
        {children}
      </main>
    </div>
  );
}
