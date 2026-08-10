"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { since } from "@/lib/orders";
import { businessDayCutoffMs, msUntilNextBusinessDay } from "@/lib/business-day";
import { signOutKitchen } from "@/app/kitchen/actions";
import { isTableSource, sourceLabel, type OrderItemRow, type OrderRow, type OrderStatus } from "@/types/order";
import { VegDot } from "@/components/menu/ItemCard";
import { LiveClock } from "@/components/LiveClock";

interface OrderWithItems extends OrderRow {
  order_items: OrderItemRow[];
}

type Lang = "en" | "hi";

// English/variant.name, or Hindi via nameHi/variant.nameHi snapshotted onto
// the line at order-placement time — falls back to English if a translation
// is somehow missing. Column headers, buttons, timestamps and source badges
// are excluded on purpose: only dish names/variants switch with the toggle.
function orderLineLabel(it: OrderItemRow, hi: boolean): string {
  if (!hi) return it.variant_name ? `${it.item_name} (${it.variant_name})` : it.item_name;
  const name = it.item_name_hi || it.item_name;
  const variant = it.variant_name ? it.variant_name_hi || it.variant_name : null;
  return variant ? `${name} (${variant})` : name;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// "Starting…" (the design's placeholder for the gap before a scripted demo
// timer flipped confirmed -> preparing) is dropped — this app has no such
// timer, confirmed_at is the real signal prep time starts counting from, so
// the countdown runs immediately once an order is accepted.
function timeLeftLabel(order: OrderRow, now: number): string {
  if (!order.confirmed_at) return "Overdue";
  const left = order.estimated_prep_minutes * 60_000 - (now - new Date(order.confirmed_at).getTime());
  return left > 0 ? `${clock(left)} left` : "Overdue";
}

const COLUMNS: {
  key: string;
  title: string;
  dotClassName: string;
  emptyText: string;
  statuses: OrderStatus[];
}[] = [
  {
    key: "new",
    title: "NEW",
    dotClassName: "bg-secondary",
    emptyText: "No new tokens. Orders from tables, the counter and the aggregators appear here instantly.",
    statuses: ["waiting_confirmation"],
  },
  {
    key: "preparing",
    title: "PREPARING",
    dotClassName: "bg-tertiary",
    emptyText: "Nothing on the fire right now.",
    statuses: ["confirmed", "preparing"],
  },
  {
    key: "ready",
    title: "READY",
    dotClassName: "bg-primary",
    emptyText: "Nothing waiting at the pass.",
    statuses: ["ready"],
  },
];

// Matches the design's kBoard kanban exactly, including the "Served" button
// on ready cards — unlike the design (which just deleted the order client
// side), this writes a real terminal `served` status, so the order stays in
// the DB but drops out of every column's filter.
export function KitchenBoard() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [now, setNow] = useState(() => Date.now());
  const [signingOut, startSignOutTransition] = useTransition();

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
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true });
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

  // Kitchen day resets at 4AM IST: reload so the board re-fetches against the
  // new day's cutoff and yesterday's orders fall off instead of piling up.
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), msUntilNextBusinessDay(Date.now()));
    return () => clearTimeout(id);
  }, []);

  // Every order, any source — the single point where customer self-orders
  // and manager-entered orders converge.
  useEffect(() => {
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch {
      return;
    }
    const channel = supabase
      .channel("kitchen:board")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as OrderRow;
        supabase
          .from("order_items")
          .select("*")
          .eq("order_id", row.id)
          .then(({ data }) => {
            setOrders((prev) => [...(prev ?? []), { ...row, order_items: (data as OrderItemRow[]) ?? [] }]);
          });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as OrderRow;
        setOrders((prev) => prev?.map((o) => (o.id === row.id ? { ...o, ...row } : o)) ?? prev);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Only status is written — confirmed_at/ready_at are stamped server-side
  // by the stamp_order_times() trigger, never trust a client clock for those.
  async function accept(id: string) {
    const { error } = await getSupabase().from("orders").update({ status: "confirmed" }).eq("id", id);
    if (error) setError(error.message);
  }
  async function markReady(id: string) {
    const { error } = await getSupabase().from("orders").update({ status: "ready" }).eq("id", id);
    if (error) setError(error.message);
  }
  // No dedicated "served" column: this status simply drops the order out of
  // every column's filter, which is the removal-from-the-board behavior.
  async function markServed(id: string) {
    const { error } = await getSupabase().from("orders").update({ status: "served" }).eq("id", id);
    if (error) setError(error.message);
  }

  function signOut() {
    startSignOutTransition(async () => {
      await signOutKitchen();
      router.push("/kitchen");
    });
  }

  const counts = {
    new: (orders ?? []).filter((o) => o.status === "waiting_confirmation").length,
    cooking: (orders ?? []).filter((o) => o.status === "confirmed" || o.status === "preparing").length,
    ready: (orders ?? []).filter((o) => o.status === "ready").length,
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <div className="flex h-[54px] flex-none items-center gap-4 bg-tertiary px-[18px] text-surface">
        <span className="font-display text-[17px]">Kitchen Pass</span>
        <span className="text-[10px] font-bold tracking-[.14em] text-secondary">LIVE ORDER BOARD</span>
        <div className="flex gap-[3px] rounded-[9px] bg-black/26 p-[3px]">
          {(["en", "hi"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={
                l === lang
                  ? "font-devanagari rounded-[6px] bg-surface px-[11px] py-1.5 text-[11px] font-extrabold text-tertiary"
                  : "font-devanagari rounded-[6px] px-[11px] py-1.5 text-[11px] font-bold text-surface/68 transition hover:text-surface"
              }
            >
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
        <LiveClock className="ml-auto text-[11px] font-semibold text-surface/75" />
        <span className="text-[11.5px] font-semibold text-surface/75">
          {counts.new} new · {counts.cooking} cooking · {counts.ready} at the pass
        </span>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="text-[11px] font-semibold text-surface/75 transition hover:text-surface hover:underline"
        >
          Sign out
        </button>
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm font-semibold text-non-veg">
          {error}
        </div>
      ) : orders === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading…</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-px bg-ink/[0.12]">
          {COLUMNS.map((col) => {
            const colOrders = orders
              .filter((o) => col.statuses.includes(o.status))
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            return (
              <div key={col.key} className="flex min-h-0 flex-col bg-background">
                <div className="flex flex-none items-center gap-[9px] border-b border-ink/10 bg-surface px-3.5 py-[11px]">
                  <span className={`h-[9px] w-[9px] rounded-full ${col.dotClassName}`} />
                  <span className="text-[12.5px] font-extrabold tracking-[.06em] text-ink">{col.title}</span>
                  <span className="rounded-full bg-ink/[0.07] px-2 py-[5px] text-[10.5px] font-bold text-muted">
                    {colOrders.length}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto p-2.5">
                  {colOrders.length === 0 && (
                    <span className="px-1 py-3 text-[11.5px] leading-[1.6] text-muted">{col.emptyText}</span>
                  )}
                  {colOrders.map((o) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      lang={lang}
                      now={now}
                      onAccept={accept}
                      onMarkReady={markReady}
                      onMarkServed={markServed}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function OrderCard({
  order,
  lang,
  now,
  onAccept,
  onMarkReady,
  onMarkServed,
}: {
  order: OrderWithItems;
  lang: Lang;
  now: number;
  onAccept: (id: string) => void;
  onMarkReady: (id: string) => void;
  onMarkServed: (id: string) => void;
}) {
  const isNew = order.status === "waiting_confirmation";
  const isCooking = order.status === "confirmed" || order.status === "preparing";
  const isDone = order.status === "ready";
  const table = isTableSource(order.source);

  return (
    <div className="animate-gc-rise flex flex-col gap-[9px] rounded-xl border border-ink/10 bg-surface p-[11px] shadow-[0_1px_3px_rgba(42,27,18,0.06)]">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-[7px] px-[11px] py-2 text-[13px] font-extrabold ${table ? "bg-tertiary text-surface" : "bg-primary text-surface"}`}
        >
          {sourceLabel(order.source)}
        </span>
        <span className="text-[10px] font-bold tracking-[.08em] text-muted">{order.id.slice(0, 8).toUpperCase()}</span>
        <span className="ml-auto text-[10.5px] font-semibold text-muted">{since(order.created_at, now)}</span>
      </div>

      <div className="flex flex-col gap-2 border-t border-dashed border-ink/[0.14] pt-2.5">
        {order.order_items.map((it) => (
          <div key={it.id} className="flex items-center gap-2">
            <span className="min-w-6 text-base font-extrabold text-primary">{it.quantity}×</span>
            <VegDot veg={it.is_veg} size={13} />
            <span className="font-devanagari flex-1 text-lg leading-[1.3] font-bold text-ink">
              {orderLineLabel(it, lang === "hi")}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        {(isNew || isDone) && (
          <span className="rounded-full border border-secondary/40 bg-secondary/[0.16] px-2 py-1.5 text-[10px] font-bold text-[#8B6C08]">
            {isDone ? "Ready to serve" : `${order.estimated_prep_minutes} min prep`}
          </span>
        )}
        {isCooking && (
          <span className="rounded-full bg-tertiary px-2 py-1.5 text-[10.5px] font-extrabold text-surface tabular-nums">
            {timeLeftLabel(order, now)}
          </span>
        )}
        {isNew && (
          <button
            onClick={() => onAccept(order.id)}
            className="ml-auto rounded-[9px] bg-tertiary px-3.5 py-2.5 text-[11.5px] font-extrabold text-surface transition hover:bg-[#1B1560]"
          >
            Accept Order
          </button>
        )}
        {isCooking && (
          <button
            onClick={() => onMarkReady(order.id)}
            className="ml-auto rounded-[9px] bg-primary px-3.5 py-2.5 text-[11.5px] font-extrabold text-surface transition hover:bg-[#7A180B]"
          >
            Mark Ready
          </button>
        )}
        {isDone && (
          <button
            onClick={() => onMarkServed(order.id)}
            className="ml-auto rounded-[9px] bg-veg px-3.5 py-2.5 text-[11.5px] font-extrabold text-surface transition hover:bg-[#245f27]"
          >
            Served
          </button>
        )}
      </div>
    </div>
  );
}
