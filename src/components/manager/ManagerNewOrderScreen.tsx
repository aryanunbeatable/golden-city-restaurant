"use client";

import { useState } from "react";
import Link from "next/link";
import type { Menu } from "@/types/menu";
import { ORDER_SOURCE_OPTIONS, type OrderSource } from "@/types/order";
import { useCart, money } from "@/lib/cart";
import { placeOrder } from "@/lib/orders";
import { MenuBrowser } from "@/components/menu/MenuBrowser";
import { LiveClock } from "@/components/LiveClock";

// Matches the design's mNewTab + right-hand Kitchen token panel exactly.
// Simplification: the design's full mDash wraps New order / Active orders in
// one tab switcher within a single screen; here they're two routes
// (/manager/new-order, /manager/orders) with a plain link between them
// instead of shared tab state.
export function ManagerNewOrderScreen({ menu }: { menu: Menu }) {
  const [source, setSource] = useState<OrderSource | null>(null);
  const cart = useCart();
  const [sentOrderId, setSentOrderId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceLabel = ORDER_SOURCE_OPTIONS.find((s) => s.value === source)?.label ?? "";

  async function sendToKitchen() {
    if (!source) return;
    setSubmitting(true);
    setError(null);
    try {
      const orderId = await placeOrder({
        source,
        placedBy: "manager",
        prepMinutes: cart.totals.prepMinutes,
        lines: cart.lines,
      });
      setSentOrderId(orderId);
      cart.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send to kitchen — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function newOrder() {
    setSentOrderId(null);
    setSource(null);
    setError(null);
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <div className="flex flex-none items-center gap-2.5 border-b border-ink/10 px-[18px] py-3">
        <Link href="/manager" className="text-xl font-bold text-primary">
          ‹
        </Link>
        <span className="font-display text-base text-primary">Golden City</span>
        <span className="rounded-md bg-tertiary px-2.5 py-1.5 text-[10px] font-bold tracking-[.14em] text-surface">
          COUNTER · ORDER ENTRY
        </span>
        <LiveClock className="ml-auto text-[11px] font-semibold text-muted" />
        <Link
          href="/manager/orders"
          className="rounded-lg border border-ink/[0.16] px-3 py-1.5 text-xs font-bold text-ink transition hover:border-primary hover:text-primary"
        >
          Active orders
        </Link>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-ink/10 px-[18px] py-3.5">
            <span className="mr-1 text-[10.5px] font-bold tracking-[.14em] text-muted">ORDER SOURCE</span>
            {ORDER_SOURCE_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSource(s.value)}
                className={
                  s.value === source
                    ? "rounded-[9px] bg-primary px-[15px] py-2.5 text-[12.5px] font-extrabold text-surface shadow-[0_4px_12px_rgba(139,29,14,0.28)]"
                    : "rounded-[9px] border border-ink/[0.16] bg-surface px-[15px] py-2.5 text-[12.5px] font-semibold text-ink transition hover:border-primary hover:text-primary"
                }
              >
                {s.label}
              </button>
            ))}
          </div>

          {!source ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
              <span className="flex h-[62px] w-[62px] items-center justify-center rounded-2xl border-[1.5px] border-dashed border-ink/25 font-display text-2xl text-primary">
                ?
              </span>
              <span className="text-[15px] font-bold text-ink">Pick where this order came from</span>
              <span className="max-w-xs text-center text-xs leading-[1.6]">
                Table 1–4 for guests ordering at the counter,
                <br />
                or Swiggy / Zomato / Parcel for everything else.
              </span>
            </div>
          ) : (
            <MenuBrowser
              menu={menu}
              density="manager"
              className="min-h-0 flex-1"
              cart={cart.lines}
              onAddItem={cart.addItem}
              onBumpItem={cart.bumpItem}
            />
          )}
        </div>

        <div className="flex w-[330px] flex-none flex-col border-l border-ink/10 bg-surface">
          {sentOrderId ? (
            <div className="animate-gc-pop-sent flex flex-1 flex-col items-center justify-center gap-4 p-[26px] text-center">
              <span className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-veg text-4xl font-light text-surface">
                ✓
              </span>
              <span className="text-lg font-extrabold text-ink">Token sent to kitchen</span>
              <span className="text-xs font-semibold text-muted">
                {sentOrderId.slice(0, 8).toUpperCase()} · {sourceLabel} · on the kitchen board now
              </span>
              <div className="flex w-full flex-col gap-2">
                <button
                  onClick={newOrder}
                  className="rounded-[11px] bg-primary py-3.5 text-[13px] font-extrabold text-surface transition hover:bg-[#7A180B]"
                >
                  New order
                </button>
                <Link
                  href="/manager/orders"
                  className="rounded-[11px] border border-ink/[0.18] py-[13px] text-center text-[12.5px] font-bold text-ink transition hover:border-tertiary hover:text-tertiary"
                >
                  View active orders
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-none items-center justify-between border-b border-ink/[0.09] px-4 pt-3.5 pb-2.5">
                <span className="font-display text-[17px] text-primary">Kitchen token</span>
                <span className="rounded-md bg-tertiary px-[9px] py-1.5 text-[10px] font-extrabold tracking-[.1em] text-surface">
                  {sourceLabel || "—"}
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto px-3.5 py-2.5">
                {cart.lines.length === 0 ? (
                  <span className="px-0.5 py-4 text-xs leading-[1.6] text-muted">
                    No items yet. Add dishes from the menu on the left — this list is what the kitchen will see.
                  </span>
                ) : (
                  cart.lines.map((l) => (
                    <div
                      key={l.key}
                      className="flex items-center gap-2 border-b border-dashed border-ink/[0.12] pb-[7px]"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-xs font-bold text-ink">{l.name}</span>
                        <span className="text-[10px] font-semibold text-muted">
                          {l.variantName ? `${l.variantName} · ` : ""}
                          {money(l.price)} each · {l.prepTimeMinutes} min
                        </span>
                      </div>
                      <div className="flex flex-none items-center gap-px overflow-hidden rounded-[7px] border border-primary/40">
                        <button
                          onClick={() => cart.bumpItem(l.key, -1)}
                          className="flex h-6 w-[22px] items-center justify-center text-[13px] font-bold text-primary"
                        >
                          −
                        </button>
                        <span className="min-w-[14px] text-center text-[11px] font-extrabold text-primary">
                          {l.qty}
                        </span>
                        <button
                          onClick={() => cart.bumpItem(l.key, 1)}
                          className="flex h-6 w-[22px] items-center justify-center text-[13px] font-bold text-primary"
                        >
                          +
                        </button>
                      </div>
                      <span className="min-w-12 text-right text-xs font-extrabold text-ink">
                        {money(l.price * l.qty)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="flex flex-none flex-col gap-2.5 border-t border-ink/10 px-4 pt-[13px] pb-4">
                <div className="flex justify-between">
                  <span className="text-xs font-semibold text-muted">Total Cost</span>
                  <span className="text-[17px] font-extrabold text-ink">{money(cart.totals.cost)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">Total Prep Time</span>
                  <span className="rounded-full border border-secondary/40 bg-secondary/[0.16] px-[9px] py-[5px] text-[11px] font-bold text-[#8B6C08]">
                    {cart.totals.prepMinutes} min
                  </span>
                </div>
                {error && <p className="text-center text-[11px] font-semibold text-non-veg">{error}</p>}
                <button
                  onClick={sendToKitchen}
                  disabled={cart.lines.length === 0 || submitting}
                  className="rounded-xl bg-primary py-[15px] text-sm font-extrabold text-surface shadow-[0_8px_20px_rgba(139,29,14,0.28)] transition hover:bg-[#7A180B] disabled:cursor-not-allowed disabled:bg-ink/[0.12] disabled:text-muted disabled:shadow-none"
                >
                  {submitting ? "Sending…" : "Send to Kitchen →"}
                </button>
                <span className="text-center text-[10.5px] leading-[1.5] text-muted">
                  Payment is collected at the counter.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
