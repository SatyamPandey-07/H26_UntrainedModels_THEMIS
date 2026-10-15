"use client";

import { ChartPieSlice, FolderSimple, Lightning, PlugsConnected, ShieldCheck } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const items = [
  { href: "/dashboard", label: "Dashboard", Icon: ChartPieSlice },
  { href: "/repos", label: "Repositories", Icon: FolderSimple },
  { href: "/runs", label: "Runs", Icon: Lightning },
  { href: "/capsules", label: "Capsules", Icon: ShieldCheck },
  { href: "/plugin", label: "Plugin", Icon: PlugsConnected },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav aria-label="App" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map(({ href, label, Icon }) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            data-tour={`nav-${label.toLowerCase()}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-white dark:text-[#120c2b]"
                : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon size={18} weight={active ? "fill" : "regular"} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
