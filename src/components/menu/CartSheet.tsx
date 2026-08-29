"use client";

import type { ReactNode } from "react";
import type { CartLine } from "@/lib/cart";
import { money } from "@/lib/cart";
import { VegDot } from "./ItemCard";

interface CartSheetProps {
  lines: CartLine[];
  totals: { cost: number; prepMinutes: number; count: number };
  onInc: (key: string) => void;
  onDec: (key: string) => void;
  onClose: () => void;
  onStartCooking: () => void;
  submitting: boolean;
  error: string | null;
  /** Phone orders reuse this sheet with their own wording and a time picker;
   *  the line-item list and totals are identical, so only these differ. */
  title?: string;
  ctaLabel?: string;
  submittingLabel?: string;
  note?: string;
  /** Rendered above the totals block — the phone flow's pickup-time picker. */
  children?: ReactNode;
  /** Lets the phone flow block checkout until a pickup time is chosen. */
  ctaDisabled?: boolean;
}

// Bottom sheet, matching the design's cartOpen block exactly. Decrementing a
// line to 0 removes it (bumpCart's own behavior) — that's the only "remove"
// control, same as the source design (no separate delete button).
export function CartSheet({
  lines,
  totals,
  onInc,
  onDec,
  onClose,
  onStartCooking,
  submitting,
  error,
  title = "Your order",
  ctaLabel = "Start Cooking →",
  submittingLabel = "Placing order…",
  note = "No payment here — settle the bill at the counter.",
  children,
  ctaDisabled = false,
}: CartSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-ink/45">
      <div onClick={onClose} className="flex-1 cursor-pointer" />
      {/* Centred and capped: the sheet is `fixed`, so it escapes the order
          flow's centred column and would otherwise span a whole desktop
          screen. No-op below 448px, which is every phone. */}
      <div className="animate-gc-sheet mx-auto flex w-full max-w-md max-h-[78%] flex-col gap-3.5 rounded-t-[26px] rounded-b-[34px] bg-background p-[18px] pb-5">
        <div className="flex items-center justify-between">
          <span className="font-display text-xl text-primary">{title}</span>
          <button
            onClick={onClose}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-ink/[0.07] text-[15px] font-semibold text-ink"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto">
          {lines.map((l) => (
            <div
              key={l.key}
              className="flex items-center gap-2.5 rounded-2xl border border-ink/[0.09] bg-surface px-3 py-[11px]"
            >
              <VegDot veg={l.veg} />
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-[12.5px] font-bold text-ink">{l.name}</span>
                <span className="text-[11px] font-semibold text-muted">
                  {l.variantName ? `${l.variantName} · ` : ""}
                  {money(l.price)} each · {l.prepTimeMinutes} min
                </span>
              </div>
              <div className="flex flex-none items-center gap-0.5 overflow-hidden rounded-[9px] border border-primary/35">
                <button
                  onClick={() => onDec(l.key)}
                  className="flex h-[26px] w-[26px] items-center justify-center text-sm font-bold text-primary"
                >
                  −
                </button>
                <span className="min-w-4 text-center text-xs font-extrabold text-primary">{l.qty}</span>
                <button
                  onClick={() => onInc(l.key)}
                  className="flex h-[26px] w-[26px] items-center justify-center text-sm font-bold text-primary"
                >
                  +
                </button>
              </div>
              <span className="min-w-[52px] text-right text-[12.5px] font-extrabold text-ink">
                {money(l.price * l.qty)}
              </span>
            </div>
          ))}
        </div>

        {children}

        <div className="flex flex-col gap-[9px] rounded-2xl border border-ink/[0.09] bg-surface px-3.5 py-[13px]">
          <div className="flex justify-between">
            <span className="text-xs font-semibold text-muted">Total Cost</span>
            <span className="text-base font-extrabold text-ink">{money(totals.cost)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Total Preparation Time</span>
            <span className="rounded-full border border-secondary/40 bg-secondary/[0.16] px-[9px] py-[5px] text-[11px] font-bold text-[#8B6C08]">
              {totals.prepMinutes} min
            </span>
          </div>
          <span className="text-[11px] leading-[1.5] text-muted">{note}</span>
        </div>

        {error && <p className="text-center text-[12px] font-semibold text-non-veg">{error}</p>}

        <button
          onClick={onStartCooking}
          disabled={submitting || ctaDisabled || lines.length === 0}
          className="rounded-2xl bg-primary py-4 text-[15px] font-extrabold text-surface shadow-[0_10px_24px_rgba(139,29,14,0.3)] transition hover:bg-[#7A180B] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? submittingLabel : ctaLabel}
        </button>
      </div>
    </div>
  );
}
