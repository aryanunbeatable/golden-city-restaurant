"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { since } from "@/lib/orders";
import { orderTotal } from "@/lib/history-report";
import { money } from "@/lib/cart";
import { businessDayCutoffMs, msUntilNextBusinessDay } from "@/lib/business-day";
import { clockLabel } from "@/lib/service-hours";
import { playApprovalChime } from "@/lib/use-pending-approvals";
import {
  isTableSource,
  sourceLabel,
  type OrderItemRow,
  type OrderRow,
  type OrderWithItems,
} from "@/types/order";
import { LiveClock } from "@/components/LiveClock";
import { ManagerNav } from "@/components/manager/ManagerNav";
import { OrderActions, STATUS_STYLE } from "@/components/manager/OrderActions";
import { ApprovalCard } from "@/components/manager/ApprovalCard";

const TABLES = ["table_1", "table_2", "table_3", "table_4"] as const;

function itemCount(items: OrderItemRow[]): number {
  return items.reduce((a, it) => a + it.quantity, 0);
}

function summarize(items: OrderItemRow[]): string {
  return items
    .map((it) => `${it.quantity}× ${it.item_name}${it.variant_name ? ` (${it.variant_name})` : ""}`)
    .join(", ");
}

function isLive(o: OrderRow): boolean {
  return o.status !== "served" && o.status !== "cancelled" && o.status !== "awaiting_payment";
}

/** Approved and scheduled, but the kitchen should already have started it. */
function isRunningLate(o: OrderRow, now: number): boolean {
  if (!o.scheduled_for) return false;
  if (o.status !== "confirmed" && o.status !== "preparing") return false;
  return now > new Date(o.scheduled_for).getTime() - o.estimated_prep_minutes * 60_000;
}

/**
 * The counter's live view of the whole restaurant. Organised by what needs the
 * manager rather than by status: during service almost every order needs
 * nothing from them, so a flat list of everything buries the two that do.
 */
export function ManagerOrdersList() {
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showCompleted, setShowCompleted] = useState(false);
  const [openTable, setOpenTable] = useState<string | null>(null);

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
        // An unpaid checkout is not an order — it must never appear here.
        .neq("status", "awaiting_payment")
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

  // Same 4AM boundary as the kitchen board.
  useEffect(() => {
    const id = setTimeout(() => window.location.reload(), msUntilNextBusinessDay(Date.now()));
    return () => clearTimeout(id);
  }, []);

  // Every source now, not just the counter — so no placed_by filter.
  useEffect(() => {
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch {
      return;
    }
    const channel = supabase
      .channel("manager:service-board")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as OrderRow;
        if (row.status === "awaiting_payment") return;
        supabase
          .from("order_items")
          .select("*")
          .eq("order_id", row.id)
          .then(({ data }) => {
            setOrders((prev) => [
              { ...row, order_items: (data as OrderItemRow[]) ?? [] },
              ...(prev ?? []),
            ]);
          });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as OrderRow;
        setOrders((prev) => {
          if (!prev) return prev;
          const known = prev.some((o) => o.id === row.id);
          // A phone order becomes visible the moment payment lands, which
          // arrives as an UPDATE out of awaiting_payment, not an INSERT.
          if (!known) {
            if (row.status === "awaiting_payment") return prev;
            void supabase
              .from("order_items")
              .select("*")
              .eq("order_id", row.id)
              .then(({ data }) => {
                setOrders((cur) =>
                  cur && !cur.some((o) => o.id === row.id)
                    ? [{ ...row, order_items: (data as OrderItemRow[]) ?? [] }, ...cur]
                    : cur,
                );
              });
            return prev;
          }
          return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o));
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function applyLocal(id: string, patch: Partial<OrderRow>) {
    setOrders((prev) => prev?.map((o) => (o.id === id ? { ...o, ...patch } : o)) ?? prev);
  }

  const all = useMemo(() => orders ?? [], [orders]);
  const live = useMemo(() => all.filter(isLive), [all]);

  const approvals = useMemo(
    () => all.filter((o) => o.source === "phone" && o.status === "waiting_confirmation"),
    [all],
  );
  const unpaidReady = useMemo(
    () => live.filter((o) => o.status === "ready" && o.payment_status === "pending"),
    [live],
  );
  const phoneLive = useMemo(
    () =>
      live
        .filter((o) => o.source === "phone" && o.status !== "waiting_confirmation")
        .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? "")),
    [live],
  );
  const counterLive = useMemo(
    () => live.filter((o) => !isTableSource(o.source) && o.source !== "phone"),
    [live],
  );
  const completed = useMemo(
    () => all.filter((o) => o.status === "served" || o.status === "cancelled"),
    [all],
  );

  // Chime when a new approval lands. A ref, so this never triggers a render.
  const lastApprovalCount = useRef<number | null>(null);
  useEffect(() => {
    if (lastApprovalCount.current !== null && approvals.length > lastApprovalCount.current) {
      playApprovalChime();
    }
    lastApprovalCount.current = approvals.length;
  }, [approvals.length]);

  const cooking = live.filter((o) => o.status === "confirmed" || o.status === "preparing").length;
  const atPass = live.filter((o) => o.status === "ready").length;
  const takings = all
    .filter((o) => o.status !== "cancelled" && o.payment_status === "paid")
    .reduce((sum, o) => sum + orderTotal(o.order_items), 0);
  const needsYou = approvals.length + unpaidReady.length;

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <ManagerNav active="orders">
        <LiveClock className="text-[11px] font-semibold text-muted" />
      </ManagerNav>

      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-ink/10 px-4 py-2.5 md:px-6">
        <Stat n={needsYou} label="need you" tone={needsYou > 0 ? "alert" : "calm"} />
        <Stat n={cooking} label="cooking" tone="calm" />
        <Stat n={atPass} label="at the pass" tone="calm" />
        <span className="ml-auto text-[12px] font-extrabold text-ink">
          {money(takings)}
          <span className="pl-1 text-[10.5px] font-semibold text-muted">taken today</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-non-veg/30 bg-non-veg/[0.08] px-3.5 py-2.5 text-[12px] font-semibold text-non-veg">
            {error}
          </div>
        )}
        {!error && orders === null && <span className="text-[12.5px] text-muted">Loading…</span>}

        {orders !== null && (
          <div className="flex flex-col gap-6">
            {needsYou > 0 && (
              <section className="flex flex-col gap-2.5">
                <SectionTitle>Needs you</SectionTitle>
                {approvals.map((o) => (
                  <ApprovalCard
                    key={o.id}
                    order={o}
                    now={now}
                    onApplied={(patch) => applyLocal(o.id, patch)}
                    onError={setError}
                  />
                ))}
                {unpaidReady.map((o) => (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center gap-2.5 rounded-xl border border-secondary/50 bg-secondary/[0.1] p-3.5"
                  >
                    <SourceBadge order={o} />
                    <span className="text-[12.5px] font-bold text-ink">
                      Ready — {money(orderTotal(o.order_items))} to collect
                    </span>
                    <span className="text-[11px] font-semibold text-muted">{since(o.created_at, now)}</span>
                    <div className="ml-auto">
                      <OrderActions
                        order={o}
                        onApplied={(patch) => applyLocal(o.id, patch)}
                        onError={setError}
                      />
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section className="flex flex-col gap-2.5">
              <SectionTitle>Tables</SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TABLES.map((t) => {
                  const order = live.find((o) => o.source === t) ?? null;
                  return (
                    <TableTile
                      key={t}
                      table={t}
                      order={order}
                      now={now}
                      open={openTable === t}
                      onToggle={() => setOpenTable(openTable === t ? null : t)}
                    />
                  );
                })}
              </div>
              {openTable && (
                <TableDetail
                  order={live.find((o) => o.source === openTable) ?? null}
                  now={now}
                  onApplied={applyLocal}
                  onError={setError}
                />
              )}
            </section>

            {phoneLive.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <SectionTitle>Phone &amp; scheduled</SectionTitle>
                {phoneLive.map((o) => (
                  <OrderRowCard
                    key={o.id}
                    order={o}
                    now={now}
                    onApplied={applyLocal}
                    onError={setError}
                  />
                ))}
              </section>
            )}

            {counterLive.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <SectionTitle>Counter, aggregators &amp; parcel</SectionTitle>
                {counterLive.map((o) => (
                  <OrderRowCard
                    key={o.id}
                    order={o}
                    now={now}
                    onApplied={applyLocal}
                    onError={setError}
                  />
                ))}
              </section>
            )}

            {live.length === 0 && approvals.length === 0 && (
              <div className="rounded-xl border border-dashed border-ink/20 px-5 py-10 text-center text-[12.5px] text-muted">
                Nothing live right now. Orders from tables, the counter, the aggregators and the phone link
                all land here.
              </div>
            )}

            <section className="flex flex-col gap-2.5">
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-2 self-start text-[11px] font-bold tracking-[.12em] text-muted transition hover:text-ink"
              >
                {completed.length} COMPLETED TODAY
                <span className="text-[13px]">{showCompleted ? "▾" : "▸"}</span>
              </button>
              {showCompleted &&
                completed.map((o) => (
                  <OrderRowCard
                    key={o.id}
                    order={o}
                    now={now}
                    onApplied={applyLocal}
                    onError={setError}
                  />
                ))}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-bold tracking-[.12em] text-muted">{children}</span>;
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "alert" | "calm" }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={`text-[15px] font-extrabold ${tone === "alert" ? "text-non-veg" : "text-ink"}`}>{n}</span>
      <span className="text-[10.5px] font-semibold text-muted">{label}</span>
    </span>
  );
}

function SourceBadge({ order }: { order: OrderRow }) {
  return (
    <span
      className={`rounded-[7px] px-2.5 py-1.5 text-[11px] font-extrabold ${
        isTableSource(order.source) ? "bg-tertiary text-surface" : "bg-primary text-surface"
      }`}
    >
      {sourceLabel(order.source)}
    </span>
  );
}

function TableTile({
  table,
  order,
  now,
  open,
  onToggle,
}: {
  table: string;
  order: OrderWithItems | null;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const label = sourceLabel(table as OrderRow["source"]);
  const status = order ? STATUS_STYLE[order.status] : null;
  const unpaid = order?.status === "ready" && order.payment_status === "pending";

  return (
    <button
      onClick={onToggle}
      disabled={!order}
      className={`flex min-h-[86px] flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition ${
        !order
          ? "border-dashed border-ink/15 bg-transparent"
          : unpaid
            ? "border-secondary/60 bg-secondary/[0.12]"
            : open
              ? "border-primary bg-primary/[0.06]"
              : "border-ink/[0.12] bg-surface hover:border-primary"
      }`}
    >
      <span className="text-[11px] font-bold tracking-[.1em] text-muted">{label}</span>
      {!order ? (
        <span className="text-[12px] font-semibold text-muted/70">Free</span>
      ) : (
        <>
          <span className={`rounded-full px-2 py-1 text-[10.5px] font-bold ${status!.className}`}>
            {status!.label}
          </span>
          <span className="text-[11px] font-semibold text-muted">
            {itemCount(order.order_items)} items · {money(orderTotal(order.order_items))}
          </span>
          <span className="text-[10px] font-semibold text-muted">{since(order.created_at, now)}</span>
        </>
      )}
    </button>
  );
}

function TableDetail({
  order,
  now,
  onApplied,
  onError,
}: {
  order: OrderWithItems | null;
  now: number;
  onApplied: (id: string, patch: Partial<OrderRow>) => void;
  onError: (m: string) => void;
}) {
  if (!order) return null;
  return <OrderRowCard order={order} now={now} onApplied={onApplied} onError={onError} />;
}

function OrderRowCard({
  order,
  now,
  onApplied,
  onError,
}: {
  order: OrderWithItems;
  now: number;
  onApplied: (id: string, patch: Partial<OrderRow>) => void;
  onError: (m: string) => void;
}) {
  const status = STATUS_STYLE[order.status];
  const voided = order.status === "cancelled";
  const late = isRunningLate(order, now);

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border p-3.5 ${
        voided ? "border-ink/[0.09] bg-surface opacity-55" : late ? "border-non-veg/50 bg-non-veg/[0.05]" : "border-ink/[0.09] bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge order={order} />
        <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${status.className}`}>
          {status.label}
        </span>
        {order.customer_name && (
          <span className="text-[12px] font-bold text-ink">{order.customer_name}</span>
        )}
        {order.scheduled_for && (
          <span
            className={`rounded-full px-2 py-1 text-[10.5px] font-bold ${
              late ? "bg-non-veg text-surface" : "bg-ink/[0.07] text-muted"
            }`}
          >
            {late ? "LATE · " : ""}
            by {clockLabel(new Date(order.scheduled_for).getTime())}
          </span>
        )}
        <span className="text-[10.5px] font-semibold text-muted">{since(order.created_at, now)}</span>
        <span className="ml-auto text-[13px] font-extrabold text-ink">
          {money(orderTotal(order.order_items))}
        </span>
      </div>

      <span className={`text-[12px] font-semibold text-ink ${voided ? "line-through" : ""}`}>
        {summarize(order.order_items)}
      </span>

      {!voided && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-ink/[0.14] pt-2">
          <OrderActions
            order={order}
            onApplied={(patch) => onApplied(order.id, patch)}
            onError={onError}
          />
        </div>
      )}
    </div>
  );
}
