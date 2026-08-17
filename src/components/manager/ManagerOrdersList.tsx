"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { since } from "@/lib/orders";
import { businessDayCutoffMs, msUntilNextBusinessDay } from "@/lib/business-day";
import { isTableSource, sourceLabel, type OrderItemRow, type OrderRow, type OrderStatus } from "@/types/order";
import { LiveClock } from "@/components/LiveClock";

interface OrderWithItems extends OrderRow {
  order_items: OrderItemRow[];
}

const STATUS_STYLE: Record<OrderStatus, { label: string; className: string }> = {
  waiting_confirmation: {
    label: "Waiting",
    className: "border border-secondary/45 bg-secondary/[0.18] text-[#8B6C08]",
  },
  confirmed: { label: "Confirmed", className: "bg-tertiary text-surface" },
  preparing: { label: "Preparing", className: "bg-tertiary text-surface" },
  ready: { label: "Ready", className: "bg-primary text-surface" },
  served: { label: "Served", className: "bg-veg text-surface" },
};

function summarize(items: OrderItemRow[]): string {
  return items.map((it) => `${it.quantity}× ${it.item_name}${it.variant_name ? ` (${it.variant_name})` : ""}`).join(", ");
}

function itemCount(items: OrderItemRow[]): number {
  return items.reduce((a, it) => a + it.quantity, 0);
}

const GRID_COLS = "grid-cols-[130px_1fr_120px_150px_120px]";

// Matches the design's mListTab exactly — the "Active orders" tab content
// inside mDash — as its own route rather than a tab, since /manager/new-order
// already exists as a standalone screen. Tracking only, no actions: per the
// design (and this task), accept/ready lives on the kitchen board.
export function ManagerOrdersList() {
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cutoff = new Date(businessDayCutoffMs(Date.now())).toISOString();
      const { data, error } = await getSupabase()
        .from("orders")
        .select("*, order_items(*)")
        .eq("placed_by", "manager")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) setError(error.message);
      else setOrders((data ?? []) as OrderWithItems[]);
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Same kitchen-day boundary as the kitchen board: reload at 4AM IST so this
  // list re-fetches against the new day's cutoff instead of accumulating
  // every order ever placed from the counter.
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), msUntilNextBusinessDay(Date.now()));
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch {
      return;
    }
    const channel = supabase
      .channel("manager:orders")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: "placed_by=eq.manager" },
        (payload) => {
          const row = payload.new as OrderRow;
          // Items aren't in the realtime payload (it's orders-table only) —
          // one refetch, safe because create_order() commits both in one
          // transaction, so the items are guaranteed to exist by now.
          supabase
            .from("order_items")
            .select("*")
            .eq("order_id", row.id)
            .then(({ data }) => {
              setOrders((prev) => [{ ...row, order_items: (data as OrderItemRow[]) ?? [] }, ...(prev ?? [])]);
            });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: "placed_by=eq.manager" },
        (payload) => {
          const row = payload.new as OrderRow;
          setOrders((prev) => prev?.map((o) => (o.id === row.id ? { ...o, ...row } : o)) ?? prev);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
          href="/manager/new-order"
          className="rounded-lg border border-ink/[0.16] px-3 py-1.5 text-xs font-bold text-ink transition hover:border-primary hover:text-primary"
        >
          + New order
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex items-baseline gap-2.5 pb-3.5">
          <span className="font-display text-[22px] text-primary">Orders from this counter</span>
          <span className="text-[11.5px] font-semibold text-muted">
            Tokens keyed in here — tables on request, Swiggy, Zomato and parcels
          </span>
        </div>

        <div className={`grid ${GRID_COLS} gap-2.5 px-3.5 pb-2 text-[10px] font-bold tracking-[.12em] text-muted`}>
          <span>SOURCE</span>
          <span>ITEMS</span>
          <span>COUNT</span>
          <span>STATUS</span>
          <span>PLACED</span>
        </div>

        <div className="flex flex-col gap-2">
          {error && <span className="px-3.5 py-5 text-[12.5px] font-semibold text-non-veg">{error}</span>}

          {!error && orders === null && (
            <span className="px-3.5 py-5 text-[12.5px] text-muted">Loading…</span>
          )}

          {!error && orders?.length === 0 && (
            <span className="px-3.5 py-5 text-[12.5px] leading-[1.6] text-muted">
              Nothing keyed in yet. Start a new order to send your first digital token.
            </span>
          )}

          {orders?.map((o) => {
            const status = STATUS_STYLE[o.status];
            return (
              <div
                key={o.id}
                className={`grid ${GRID_COLS} items-center gap-2.5 rounded-xl border border-ink/[0.09] bg-surface p-3.5`}
              >
                <span
                  className={`justify-self-start rounded-[7px] px-[11px] py-2 text-[11.5px] font-extrabold ${
                    isTableSource(o.source) ? "bg-tertiary text-surface" : "bg-primary text-surface"
                  }`}
                >
                  {sourceLabel(o.source)}
                </span>
                <span className="truncate text-xs font-semibold text-ink">{summarize(o.order_items)}</span>
                <span className="text-xs font-bold text-muted">{itemCount(o.order_items)} items</span>
                <span
                  className={`justify-self-start rounded-full px-2.5 py-1.5 text-[11px] font-bold ${status.className}`}
                >
                  {status.label}
                </span>
                <span className="text-[11.5px] font-semibold text-muted">{since(o.created_at, now)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
