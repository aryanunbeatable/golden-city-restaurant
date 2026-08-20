"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { money } from "@/lib/cart";
import { clockLabel } from "@/lib/service-hours";
import type { OrderItemRow, OrderRow } from "@/types/order";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; order: OrderRow; items: OrderItemRow[] };

/**
 * Scheduled phone orders are a different shape of wait to a table order: the
 * customer already knows when the food is due, so a live countdown would only
 * invite them to stare at it. The promise here is the ready-by time, and the
 * state of the order against it.
 */
export function PhoneOrderTracker({ orderId }: { orderId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

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
        setState({ kind: "error", message: "We couldn't find that order." });
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
        <span className="rounded-full bg-tertiary px-2.5 py-1.5 text-[10px] font-bold tracking-[.1em] text-surface">
          {takeaway ? "TAKEAWAY" : "DINE-IN"}
        </span>
      </div>

      <div className="flex min-h-[248px] flex-col items-center justify-center gap-4 rounded-[22px] border border-ink/[0.09] bg-surface px-5 py-[26px] text-center">
        <PhoneStatusVisual order={order} readyBy={readyBy} takeaway={takeaway} />
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-ink/[0.09] bg-surface px-4 pt-4 pb-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-[.12em] text-muted">
            TOKEN {order.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="text-[10.5px] font-semibold text-muted">
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

      <p className="text-center text-[10.5px] leading-[1.6] text-muted">
        Keep this page — it&apos;s the only link to your order.
      </p>
    </main>
  );
}

function PhoneStatusVisual({
  order,
  readyBy,
  takeaway,
}: {
  order: OrderRow;
  readyBy: string | null;
  takeaway: boolean;
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
    return (
      <div className="animate-gc-pop-ready flex flex-col items-center gap-4">
        <span className="flex h-[96px] w-[96px] items-center justify-center rounded-full bg-primary font-display text-4xl text-secondary shadow-[0_12px_30px_rgba(139,29,14,0.3)]">
          ✦
        </span>
        <span className="font-display text-2xl text-primary">Ready!</span>
        <span className="text-[12.5px] leading-[1.6] text-muted">
          {takeaway
            ? "Your order is packed and waiting at the counter."
            : "Your table's food is coming out now."}
        </span>
      </div>
    );
  }

  // confirmed / preparing — accepted and scheduled.
  return (
    <div className="animate-gc-rise flex flex-col items-center gap-4">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-veg text-[44px] font-light text-surface">
        ✓
      </span>
      <div className="flex flex-col gap-1.5">
        <span className="text-[19px] font-extrabold text-ink">Confirmed</span>
        {readyBy && (
          <span className="font-display text-[26px] text-primary">Ready by {readyBy}</span>
        )}
        <span className="text-[12.5px] leading-[1.6] text-muted">
          {takeaway
            ? "Come to the counter at that time and it'll be waiting."
            : "Come in at that time and we'll have it ready."}
        </span>
      </div>
    </div>
  );
}
