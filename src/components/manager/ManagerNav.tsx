"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePendingApprovals } from "@/lib/use-pending-approvals";

const LINKS = [
  { key: "new-order", href: "/manager/new-order", label: "New order" },
  { key: "orders", href: "/manager/orders", label: "Active orders" },
  { key: "billing", href: "/manager/billing", label: "Billing" },
  { key: "history", href: "/manager/history", label: "History" },
] as const;

export type ManagerNavKey = (typeof LINKS)[number]["key"];

// Shared across the three manager screens so a fourth link never has to be
// added in three places. Wraps on narrow screens instead of overflowing —
// the counter terminal isn't always a 16:9 monitor.
export function ManagerNav({ active, children }: { active: ManagerNavKey; children?: ReactNode }) {
  const pending = usePendingApprovals();
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-ink/10 px-4 py-3 md:px-[18px]">
      <Link href="/manager" className="text-xl font-bold text-primary">
        ‹
      </Link>
      <span className="font-display text-base text-primary">Golden City</span>
      <span className="hidden rounded-md bg-tertiary px-2.5 py-1.5 text-[10px] font-bold tracking-[.14em] text-surface sm:inline">
        COUNTER · ORDER ENTRY
      </span>
      <div className="ml-auto flex items-center gap-2.5">{children}</div>
      <div className="flex w-full gap-1.5 md:w-auto">
        {LINKS.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            aria-current={l.key === active ? "page" : undefined}
            className={
              l.key === active
                ? "flex-1 rounded-lg bg-primary px-3 py-1.5 text-center text-xs font-bold text-surface md:flex-none"
                : "flex-1 rounded-lg border border-ink/[0.16] px-3 py-1.5 text-center text-xs font-bold text-ink transition hover:border-primary hover:text-primary md:flex-none"
            }
          >
            {l.label}
            {l.key === "orders" && pending > 0 && (
              <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-secondary px-1 py-0.5 text-[10px] font-extrabold text-ink">
                {pending}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
