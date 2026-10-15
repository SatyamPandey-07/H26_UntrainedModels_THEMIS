import { GithubLogo } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { ButtonLink } from "../ui/button";
import { ThemeToggle } from "../theme-toggle";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";

const links = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/capsule/sample", label: "Sample capsule" },
  { href: "/#plugin", label: "Claude Code plugin" },
];

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-transparent bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 md:px-6"
      >
        <Logo />
        <ul className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-1">
          <MobileMenu links={links} />
          <ThemeToggle />
          {signedIn ? (
            <ButtonLink href="/dashboard" size="sm">
              Open dashboard
            </ButtonLink>
          ) : (
            <ButtonLink href="/api/auth/login" size="sm">
              <GithubLogo size={16} weight="bold" aria-hidden="true" />
              Sign in<span className="hidden sm:inline"> with GitHub</span>
            </ButtonLink>
          )}
        </div>
      </nav>
    </header>
  );
}
