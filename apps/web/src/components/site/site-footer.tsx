import Link from "next/link";
import { Logo } from "./logo";

const REPO = "https://github.com/SatyamPandey-07/H26_UntrainedModels_THEMIS";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-6">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-ink-muted">
            Dependency migrations with evidence for every claim. Draft pull requests only; you decide what
            merges.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Product</h3>
          <ul className="mt-3 grid gap-2 text-sm text-ink-muted">
            <li>
              <Link href="/how-it-works" className="hover:text-ink">
                How it works
              </Link>
            </li>
            <li>
              <Link href="/capsule/sample" className="hover:text-ink">
                Sample capsule
              </Link>
            </li>
            <li>
              <Link href="/#plugin" className="hover:text-ink">
                Claude Code plugin
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Project</h3>
          <ul className="mt-3 grid gap-2 text-sm text-ink-muted">
            <li>
              <a href={REPO} className="hover:text-ink">
                Source on GitHub
              </a>
            </li>
            <li>
              <a href={`${REPO}/issues`} className="hover:text-ink">
                Support
              </a>
            </li>
            <li>
              <a href={`${REPO}/blob/main/docs/Themis-PRD.pdf`} className="hover:text-ink">
                Product requirements
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Legal</h3>
          <ul className="mt-3 grid gap-2 text-sm text-ink-muted">
            <li>
              <a href={`${REPO}/blob/main/PRIVACY.md`} className="hover:text-ink">
                Privacy policy
              </a>
            </li>
          </ul>
        </div>
      </div>
      <p className="mx-auto max-w-7xl px-4 pb-10 text-xs text-ink-muted md:px-6">
        Built by Untrained Models for H26. Themis never merges and never writes to your default branch.
      </p>
    </footer>
  );
}
