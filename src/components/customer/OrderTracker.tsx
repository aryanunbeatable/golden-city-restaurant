"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { money } from "@/lib/cart";
import { since } from "@/lib/orders";
import type { TableId } from "@/lib/table";
import { sourceLabel, type OrderItemRow, type OrderRow } from "@/types/order";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; order: OrderRow; items: OrderItemRow[] };

// remaining()/clock() are the real-time equivalents of the design's — no
// demoSpeed multiplier, since that only existed to fast-forward the demo.
function remainingMs(estimatedPrepMinutes: number, confirmedAt: string, now: number): number {
  return estimatedPrepMinutes * 60_000 - (now - new Date(confirmedAt).getTime());
}
function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const CONFETTI_COLORS = ["var(--color-secondary)", "var(--color-primary)", "var(--color-tertiary)"];

// How long the "Order confirmed" tick holds before the countdown takes over.
// Long enough to register, short enough that nobody thinks it's the end state.
const CONFIRM_BEAT_MS = 4_000;

export function OrderTracker({ tableId, orderId }: { tableId: TableId; orderId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());

  // Ticks for as long as the screen is open — drives both the countdown and
  // the "placed Xs ago" line on the receipt, same as the design's single
  // global clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await getSupabase()
        .from("orders")
        .select("*, order_items(*)")
        .eq("id", orderId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        setState({ kind: "error", message: error?.message ?? "Order not found." });
      } else {
        const { order_items, ...order } = data as OrderRow & { order_items: OrderItemRow[] };
        setState({ kind: "ready", order: order as OrderRow, items: order_items });
      }
    })().catch((e: unknown) => {
      if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Realtime: the only thing that actually moves this order to 'ready' — the
  // countdown below is a display estimate, this subscription is the truth.
  useEffect(() => {
    // getSupabase() throws synchronously if unconfigured — the fetch effect
    // above already surfaces that as a graceful error state, so here we just
    // skip subscribing rather than let it escape past React into a crash.
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`order:${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload) => {
          setState((prev) => (prev.kind === "ready" ? { ...prev, order: payload.new as OrderRow } : prev));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  if (state.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-sm text-muted">Loading…</main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted">{state.message}</p>
        <Link href={`/table/${tableId}`} className="text-sm font-bold text-primary">
          Back to menu
        </Link>
      </main>
    );
  }

  const { order, items } = state;
  const total = items.reduce((a, it) => a + it.unit_price * it.quantity, 0);

  return (
    <main className="flex min-h-screen flex-col gap-[18px] px-[22px] pt-[22px] pb-[26px]">
      <div className="flex items-center justify-between">
        <span className="font-display text-[17px] text-primary">Your order</span>
        <span className="rounded-full bg-tertiary px-2.5 py-1.5 text-[10px] font-bold tracking-[.1em] text-surface">
          {sourceLabel(order.source)}
        </span>
      </div>

      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-[22px] border border-ink/[0.09] bg-surface px-5 py-[26px] text-center">
        <StatusVisual order={order} now={now} />
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-ink/[0.09] bg-surface px-4 pt-4 pb-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-[.12em] text-muted">
            TOKEN {order.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="text-[10.5px] font-semibold text-muted">Placed {since(order.created_at, now)}</span>
        </div>
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-[9px]">
            <span className="min-w-[22px] text-[12px] font-extrabold text-primary">{it.quantity}×</span>
            <span className="flex-1 text-[12.5px] font-semibold text-ink">
              {it.item_name}
              {it.variant_name ? ` (${it.variant_name})` : ""}
            </span>
            <span className="text-[12px] font-bold text-ink">{money(it.unit_price * it.quantity)}</span>
          </div>
        ))}
        <div className="mt-0.5 h-px bg-ink/10" />
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-bold text-muted">Total · pay at counter</span>
          <span className="text-[17px] font-extrabold text-primary">{money(total)}</span>
        </div>
      </div>

      <Link
        href={`/table/${tableId}`}
        className="rounded-xl border border-ink/[0.18] py-3 text-center text-xs font-bold text-muted transition hover:border-primary hover:text-primary"
      >
        Order something else
      </Link>
    </main>
  );
}

function StatusVisual({ order, now }: { order: OrderRow; now: number }) {
  if (order.status === "waiting_confirmation") {
    return (
      <div key="waiting" className="flex flex-col items-center gap-[18px]">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <span className="animate-gc-ring absolute inset-0 rounded-full border-2 border-primary/40" />
          <span className="animate-gc-ring absolute inset-0 rounded-full border-2 border-primary/40 [animation-delay:1.1s]" />
          <span className="animate-gc-pulse flex h-[70px] w-[70px] items-center justify-center rounded-full bg-primary font-display text-2xl text-surface">
            GC
          </span>
        </div>
        <div className="flex flex-col gap-[7px]">
          <span className="text-[19px] font-extrabold text-ink">Waiting for confirmation</span>
          <span className="text-[12.5px] leading-[1.6] text-muted">
            Your token is on the kitchen board.
            <br />
            The chef will accept it in a moment.
          </span>
        </div>
      </div>
    );
  }

  // 'confirmed' and 'preparing' are one state to the customer: the kitchen has
  // it and it's cooking. The board only ever writes 'confirmed' (Accept Order)
  // and then 'ready' — nothing writes 'preparing' — so keying the countdown to
  // 'preparing' alone left the customer staring at a static tick for the whole
  // cook. The tick is a beat, not a resting state, so it plays briefly and then
  // hands over to the timer.
  const confirmedAtMs = order.confirmed_at ? new Date(order.confirmed_at).getTime() : null;
  const inConfirmBeat =
    order.status === "confirmed" && confirmedAtMs !== null && now - confirmedAtMs < CONFIRM_BEAT_MS;

  if (inConfirmBeat) {
    return (
      <div key="confirmed" className="animate-gc-pop-confirm flex flex-col items-center gap-[18px]">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-veg text-[46px] font-light text-surface">
          ✓
        </span>
        <div className="flex flex-col gap-[7px]">
          <span className="text-xl font-extrabold text-ink">Order confirmed</span>
          <span className="text-[12.5px] text-muted">The kitchen has your token.</span>
        </div>
      </div>
    );
  }

  if (order.status === "confirmed" || order.status === "preparing") {
    // confirmed_at is stamped by the DB trigger the moment status first enters
    // confirmed/preparing, so it is set here in practice; the fallback just
    // shows a full estimate rather than a wrong one.
    const left = order.confirmed_at
      ? remainingMs(order.estimated_prep_minutes, order.confirmed_at, now)
      : order.estimated_prep_minutes * 60_000;
    const totalMs = order.estimated_prep_minutes * 60_000;
    const pct = Math.max(2, Math.min(100, Math.round((1 - Math.max(0, left) / totalMs) * 100)));
    const almost = left <= 0;

    return (
      <div key="preparing" className="animate-gc-rise flex w-full flex-col items-center gap-4">
        <div className="relative flex h-[132px] w-[132px] items-center justify-center">
          <span className="absolute inset-0 rounded-full border-[3px] border-primary/[0.14]" />
          <span className="animate-gc-ring-slow absolute inset-0 rounded-full border-[3px] border-transparent border-t-primary border-r-secondary" />
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[30px] font-extrabold text-primary tabular-nums">
              {almost ? "00:00" : clock(left)}
            </span>
            <span className="text-[9px] font-semibold tracking-[.16em] text-muted">
              {almost ? "ALMOST THERE" : "REMAINING"}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[19px] font-extrabold text-ink">
            {almost ? "Almost there" : "Preparing your order"}
          </span>
          <span className="text-[12.5px] leading-[1.6] text-muted">
            {almost
              ? "Your dishes are getting their final touch — the kitchen will call it ready any moment."
              : "Fresh from the tandoor in a few minutes."}
          </span>
        </div>
        <div className="relative h-[7px] w-full overflow-hidden rounded-full bg-primary/[0.12]">
          <span
            className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-secondary transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
          <span className="animate-gc-simmer absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
        </div>
      </div>
    );
  }

  // ready
  return (
    <div key="ready" className="animate-gc-pop-ready relative flex flex-col items-center gap-[18px]">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span
          key={i}
          className="animate-gc-confetti absolute -top-2.5 h-3 w-[7px] rounded-sm"
          style={{ left: `${8 + i * 12}%`, background: CONFETTI_COLORS[i % 3], animationDelay: `${i * 0.18}s` }}
        />
      ))}
      <span className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-primary font-display text-4xl text-secondary shadow-[0_12px_30px_rgba(139,29,14,0.3)]">
        ✦
      </span>
      <div className="flex flex-col gap-2">
        <span className="font-display text-2xl text-primary">Your order is ready!</span>
        <span className="text-[12.5px] leading-[1.6] text-muted">
          It&apos;s leaving the pass now.
          <br />
          Please pay at the counter after your meal.
        </span>
      </div>
    </div>
  );
}
