"use client";

import { List, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Marketing links on small screens, where the inline nav is hidden. */
export function MobileMenu({ links }: { links: Array<{ href: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink"
      >
        {open ? <X size={20} weight="bold" /> : <List size={20} weight="bold" />}
      </button>
      {open ? (
        <ul
          id="mobile-menu"
          className="absolute inset-x-0 top-16 grid gap-1 border-b border-border bg-surface px-4 py-3 shadow-[var(--shadow)]"
        >
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="block rounded-2xl px-4 py-3 font-medium hover:bg-surface-2">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
