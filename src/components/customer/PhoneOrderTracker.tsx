"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { money } from "@/lib/cart";
import { clockLabel } from "@/lib/service-hours";
import { countdownLabel, scheduledPhase, trackerTickMs } from "@/lib/order-clock";
import { PushOptIn } from "@/components/customer/PushOptIn";
import type { OrderItemRow, OrderRow } from "@/types/order";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; order: OrderRow; items: OrderItemRow[] };

/**
 * Scheduled phone orders are a different shape of wait to a table order. A
 * table order is one countdown from confirmation to food; this one has two
 * anchors — when the kitchen starts, and when the food is due — with a long
 * dead stretch before the first of them.
 *
 * So it runs two countdowns rather than one, and both are derived from the
 * clock rather than from status: nothing writes 'preparing', so there is no
 * event that says cooking began. See order-clock.ts. The copy hedges to match.
 */
export function PhoneOrderTracker({ orderId }: { orderId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const [now, setNow] = useState(() => Date.now());

  // Ticks only as fast as the screen actually changes: per second while a
  // countdown is showing seconds, per minute while it is coarse or counting
  // how long the food has sat at the counter, and not at all once the order is
  // finished. trackerTickMs returns one of three values, so this effect only
  // re-runs when the tracker crosses between them, not on every tick.
  const loaded = state.kind === "ready" ? state.order : null;
  const tickMs = loaded
    ? trackerTickMs(
        loaded.status,
        loaded.scheduled_for ? new Date(loaded.scheduled_for).getTime() : null,
        loaded.estimated_prep_minutes,
        now,
      )
    : null;

  useEffect(() => {
    if (tickMs === null) return;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await getSupabase()
        .from("orders")
        .select("*, order_items(*)")
        .eq("id", orderId)
        .single();
      if (cancelled) return;
      if (error || !data) {
        // Only surface an error on the very first load. A refetch that fails
        // because the tab woke up on a dead connection must not blank out an
        // order that is already on screen.
        setState((prev) => (prev.kind === "ready" ? prev : { kind: "error", message: "We couldn't find that order." }));
        return;
      }
      const { order_items, ...order } = data as OrderRow & { order_items: OrderItemRow[] };
      setState({ kind: "ready", order: order as OrderRow, items: order_items });
    }

    void load().catch((e: unknown) => {
      if (!cancelled) {
        setState((prev) => (prev.kind === "ready" ? prev : { kind: "error", message: e instanceof Error ? e.message : String(e) }));
      }
    });

    // Mobile browsers suspend the realtime socket on a backgrounded tab, and
    // Supabase does not replay what was missed on reconnect. Without this, a
    // tracker left in the background can sit on "Confirmed" indefinitely while
    // the food is already packed and waiting at the counter.
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orderId]);

  useEffect(() => {
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`phone-order:${orderId}`)
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
    return <main className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</main>;
  }
  if (state.kind === "error") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted">{state.message}</p>
        <Link href="/order" className="text-sm font-bold text-primary">
          Start a new order
        </Link>
      </main>
    );
  }

  const { order, items } = state;
  const total = items.reduce((a, it) => a + it.unit_price * it.quantity, 0);
  const readyBy = order.scheduled_for ? clockLabel(new Date(order.scheduled_for).getTime()) : null;
  const takeaway = order.service_type === "takeaway";

  return (
    <main className="flex min-h-dvh flex-col gap-[18px] px-[22px] pt-[22px] pb-[26px]">
      <div className="flex items-center justify-between">
        <span className="font-display text-[17px] text-primary">Your order</span>
        <span className="rounded-full bg-tertiary px-2.5 py-1.5 text-[11px] font-bold tracking-[.1em] text-surface">
          {takeaway ? "TAKEAWAY" : "DINE-IN"}
        </span>
      </div>

      <div className="flex min-h-[248px] flex-col items-center justify-center gap-4 rounded-[22px] border border-ink/[0.09] bg-surface px-5 py-[26px] text-center">
        <PhoneStatusVisual order={order} readyBy={readyBy} takeaway={takeaway} now={now} />
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-ink/[0.09] bg-surface px-4 pt-4 pb-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-[.04em] text-muted">
            TOKEN {order.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="text-[11px] font-semibold text-muted">
            {order.customer_name}
            {order.party_size ? ` · ${order.party_size} people` : ""}
          </span>
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
          <span className="text-[12.5px] font-bold text-muted">
            {order.payment_status === "paid" ? "Paid online" : "Total"}
          </span>
          <span className="text-[17px] font-extrabold text-primary">{money(total)}</span>
        </div>
      </div>

      {order.status !== "cancelled" && order.status !== "served" && order.status !== "ready" && (
        <PushOptIn orderId={order.id} />
      )}

      <p className="text-center text-[11px] leading-[1.6] text-muted">
        Keep this page — it&apos;s the only link to your order.
      </p>
    </main>
  );
}

function PhoneStatusVisual({
  order,
  readyBy,
  takeaway,
  now,
}: {
  order: OrderRow;
  readyBy: string | null;
  takeaway: boolean;
  now: number;
}) {
  if (order.status === "cancelled") {
    return (
      <div className="flex flex-col items-center gap-3.5">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-ink/[0.07] text-3xl text-muted">
          ✕
        </span>
        <span className="text-lg font-extrabold text-ink">Order cancelled</span>
        <span className="text-[12.5px] leading-[1.6] text-muted">
          The restaurant couldn&apos;t take this one. Your payment is being refunded — it can take a few
          working days to land.
        </span>
      </div>
    );
  }

  // Paid, but the counter hasn't accepted it yet.
  if (order.status === "waiting_confirmation") {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span className="animate-gc-ring absolute inset-0 rounded-full border-2 border-primary/40" />
          <span className="animate-gc-pulse flex h-[64px] w-[64px] items-center justify-center rounded-full bg-primary font-display text-xl text-surface">
            GC
          </span>
        </div>
        <span className="text-[19px] font-extrabold text-ink">Payment received</span>
        <span className="text-[12.5px] leading-[1.6] text-muted">
          We&apos;re confirming your order with the kitchen.
          {readyBy && (
            <>
              <br />
              You asked for it by <strong className="text-ink">{readyBy}</strong>.
            </>
          )}
        </span>
      </div>
    );
  }

  if (order.status === "ready" || order.status === "served") {
    return <ReadyVisual order={order} takeaway={takeaway} now={now} />;
  }

  // confirmed — accepted and scheduled. Everything from here is clock-derived.
  if (!order.scheduled_for) {
    return (
      <div className="animate-gc-rise flex flex-col items-center gap-4">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-veg text-[44px] font-light text-surface">
          ✓
        </span>
        <span className="text-[19px] font-extrabold text-ink">Confirmed</span>
      </div>
    );
  }

  const phase = scheduledPhase(new Date(order.scheduled_for).getTime(), order.estimated_prep_minutes, now);
  const cookingAt = clockLabel(
    new Date(order.scheduled_for).getTime() - order.estimated_prep_minutes * 60_000,
  );

  if (phase.kind === "overrun") {
    return (
      <div key="overrun" className="animate-gc-rise flex w-full flex-col items-center gap-4">
        <CountdownRing label="ALMOST THERE" value="00:00" active />
        <div className="flex flex-col gap-1.5">
          <span className="text-[19px] font-extrabold text-ink">Almost there</span>
          <span className="text-[12.5px] leading-[1.6] text-muted">
            Running a couple of minutes over — the kitchen will call it ready any moment.
          </span>
        </div>
        <LeaveNudge takeaway={takeaway} />
      </div>
    );
  }

  if (phase.kind === "pre_cook") {
    return (
      // Keyed so crossing into the cooking phase replays the entrance rather
      // than silently swapping the numbers under the customer.
      <div key="pre-cook" className="animate-gc-rise flex w-full flex-col items-center gap-4">
        <CountdownRing label="COOKING STARTS IN" value={countdownLabel(phase.msLeft)} active={false} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[19px] font-extrabold text-ink">You&apos;re booked in</span>
          <span className="text-[12.5px] leading-[1.6] text-muted">
            We&apos;ll start cooking around <strong className="text-ink">{cookingAt}</strong> so it&apos;s hot
            {takeaway ? " when you collect at " : " when it reaches your table at "}
            <strong className="text-ink">{readyBy}</strong>.
          </span>
        </div>
        {phase.leaveNow && <LeaveNudge takeaway={takeaway} />}
      </div>
    );
  }

  return (
    <div key="cooking" className="animate-gc-rise flex w-full flex-col items-center gap-4">
      <CountdownRing label="FOOD READY IN" value={countdownLabel(phase.msLeft)} active />
      <div className="flex flex-col gap-1.5">
        <span className="text-[19px] font-extrabold text-ink">On the fire</span>
        <span className="text-[12.5px] leading-[1.6] text-muted">
          Your dishes should be cooking now — ready by <strong className="text-ink">{readyBy}</strong>.
        </span>
      </div>
      <div className="relative h-[7px] w-full overflow-hidden rounded-full bg-primary/[0.12]">
        <span
          className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-secondary transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.max(2, Math.round(phase.progress * 100))}%` }}
        />
        <span className="animate-gc-simmer absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
      </div>
      {phase.leaveNow && <LeaveNudge takeaway={takeaway} />}
    </div>
  );
}

/**
 * Both timers share a ring; `active` is what separates them. Waiting for the
 * kitchen is a calm, muted dial — nothing is happening yet and the screen
 * should not pretend otherwise. Once the food is on, it picks up the warm
 * gradient the table tracker uses.
 */
function CountdownRing({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="relative flex h-[132px] w-[132px] items-center justify-center">
      <span className={`absolute inset-0 rounded-full border-[3px] ${active ? "border-primary/[0.14]" : "border-ink/[0.10]"}`} />
      <span
        className={`animate-gc-ring-slow absolute inset-0 rounded-full border-[3px] border-transparent ${
          active ? "border-t-primary border-r-secondary" : "border-t-tertiary/60"
        }`}
      />
      <div className="flex flex-col items-center gap-0.5">
        <span
          className={`font-extrabold tabular-nums ${active ? "text-primary" : "text-tertiary"} ${
            value.length > 6 ? "text-[24px]" : "text-[30px]"
          }`}
        >
          {value}
        </span>
        <span className="text-[11px] font-semibold tracking-[.16em] text-muted">{label}</span>
      </div>
    </div>
  );
}

/** Fires at LEAVE_LEAD_MS before the promised time — see order-clock.ts. */
function LeaveNudge({ takeaway }: { takeaway: boolean }) {
  return (
    <div className="animate-gc-pop-confirm flex w-full items-center gap-2.5 rounded-2xl border border-secondary/45 bg-secondary/[0.14] px-3.5 py-3 text-left">
      <span className="animate-gc-pulse text-lg">🏃</span>
      <span className="text-[12px] leading-[1.55] text-ink">
        <strong>Time to head over</strong> —{" "}
        {takeaway
          ? "it'll be at the counter in under 10 minutes."
          : "your table's food comes out in under 10 minutes."}
      </span>
    </div>
  );
}

/**
 * Ready, escalating on how long it has sat there. ready_at is stamped by the
 * database trigger, so this needs no new column. The tone stays warm at every
 * step: this is a customer who has already paid, so it states the fact and
 * lets that do the work rather than telling them off.
 */
function ReadyVisual({ order, takeaway, now }: { order: OrderRow; takeaway: boolean; now: number }) {
  const waitingMin = order.ready_at ? Math.floor((now - new Date(order.ready_at).getTime()) / 60_000) : 0;
  const cooling = waitingMin >= 5;
  const cold = waitingMin >= 15;

  return (
    <div className="animate-gc-pop-ready flex w-full flex-col items-center gap-4">
      <span
        className={`flex h-[96px] w-[96px] items-center justify-center rounded-full font-display text-4xl text-secondary shadow-[0_12px_30px_rgba(139,29,14,0.3)] ${
          cooling ? "animate-gc-pulse bg-[#8B6C08]" : "bg-primary"
        }`}
      >
        ✦
      </span>
      <span className="font-display text-2xl text-primary">
        {cold ? "Still waiting for you" : cooling ? "Ready and waiting" : "Ready!"}
      </span>
      <span className="text-[12.5px] leading-[1.6] text-muted">
        {!takeaway
          ? cold
            ? `Your table's food has been up ${waitingMin} minutes — come in and we'll bring it out.`
            : "Your table's food is coming out now."
          : cold
            ? `It's been at the counter ${waitingMin} minutes and going cold — come grab it.`
            : cooling
              ? "Best eaten hot — we're keeping it warm for you at the counter."
              : "Your order is packed and waiting at the counter."}
      </span>
    </div>
  );
}
