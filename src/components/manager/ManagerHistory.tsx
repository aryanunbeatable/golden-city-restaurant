"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "@/lib/cart";
import {
  businessDayKey,
  businessDayRange,
  businessMonthDayKeys,
  businessMonthRange,
  dayKeyWeekday,
} from "@/lib/business-day";
import { downloadCsv, fetchDayStats, fetchOrdersInRange, searchByDish } from "@/lib/history";
import { dishTotals, istTime, orderTotal, summarizeDay, toCsv, type DayStat } from "@/lib/history-report";
import { isTableSource, paymentLabel, sourceLabel, type OrderRow, type OrderWithItems } from "@/types/order";
import { LiveClock } from "@/components/LiveClock";
import { ManagerNav } from "@/components/manager/ManagerNav";
import { OrderActions, STATUS_STYLE } from "@/components/manager/OrderActions";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function longDate(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Every order ever punched, from tables and the counter alike, filed by the
// same 4AM-to-4AM kitchen day the board and the live list use — so "18 Aug"
// means one service, not one calendar date.
export function ManagerHistory() {
  const [today] = useState(() => businessDayKey(Date.now()));
  const [cursor, setCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m };
  });
  const [dayKey, setDayKey] = useState<string | null>(today);
  // Each fetch result is stored with the key it was fetched for; anything that
  // doesn't match what's currently selected reads as "still loading". That
  // beats clearing state synchronously in the effect, which would mean a
  // cascading render on every month or day change.
  const [statsFor, setStatsFor] = useState<{ key: string; map: Map<string, DayStat> } | null>(null);
  const [dayFor, setDayFor] = useState<{ key: string; orders: OrderWithItems[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [allTime, setAllTime] = useState(false);
  const [results, setResults] = useState<OrderWithItems[] | null>(null);
  const [searching, setSearching] = useState(false);

  const monthKey = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;
  const monthRange = useMemo(
    () => businessMonthRange(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const stats = statsFor?.key === monthKey ? statsFor.map : null;
  const dayOrders = dayKey && dayFor?.key === dayKey ? dayFor.orders : null;

  useEffect(() => {
    let cancelled = false;
    fetchDayStats(monthRange.startMs, monthRange.endMs)
      .then((map) => !cancelled && setStatsFor({ key: monthKey, map }))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [monthKey, monthRange]);

  useEffect(() => {
    if (!dayKey) return;
    let cancelled = false;
    const { startMs, endMs } = businessDayRange(dayKey);
    fetchOrdersInRange(startMs, endMs)
      .then((orders) => !cancelled && setDayFor({ key: dayKey, orders }))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [dayKey]);

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      if (m < 1) return { year: c.year - 1, month: 12 };
      if (m > 12) return { year: c.year + 1, month: 1 };
      return { year: c.year, month: m };
    });
    setDayKey(null);
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSubmitted(q);
    setError(null);
    try {
      setResults(await searchByDish(q, allTime ? null : monthRange));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setSubmitted("");
    setResults(null);
  }

  async function exportMonth() {
    try {
      const orders = await fetchOrdersInRange(monthRange.startMs, monthRange.endMs);
      const mm = String(cursor.month).padStart(2, "0");
      downloadCsv(`golden-city-${cursor.year}-${mm}.csv`, toCsv(orders));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function applyLocal(id: string, patch: Partial<OrderRow>) {
    const patchOne = (o: OrderWithItems) => (o.id === id ? { ...o, ...patch } : o);
    setDayFor((prev) => (prev ? { ...prev, orders: prev.orders.map(patchOne) } : prev));
    setResults((prev) => prev?.map(patchOne) ?? prev);
    // A void changes the day's totals, so the calendar cell is now stale.
    if (patch.status === "cancelled") {
      fetchDayStats(monthRange.startMs, monthRange.endMs)
        .then((map) => setStatsFor({ key: monthKey, map }))
        .catch(() => {});
    }
  }

  const dayKeys = businessMonthDayKeys(cursor.year, cursor.month);
  const monthTotals = [...(stats?.values() ?? [])].reduce(
    (a, s) => ({ count: a.count + s.count, revenue: a.revenue + s.revenue }),
    { count: 0, revenue: 0 },
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <ManagerNav active="history">
        <LiveClock className="text-[11px] font-semibold text-muted" />
      </ManagerNav>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-baseline gap-2.5 pb-4">
          <span className="font-display text-[22px] text-primary">Order history</span>
          <span className="text-[11.5px] font-semibold text-muted">
            Every order ever punched — tables, counter and aggregators — by kitchen day (4AM–4AM)
          </span>
        </div>

        <form onSubmit={runSearch} className="flex flex-wrap items-center gap-2 pb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a dish — e.g. Paneer Handi"
            className="min-w-0 flex-1 rounded-lg border border-ink/[0.16] bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-muted focus:border-primary md:max-w-xs"
          />
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
            <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
            All time
          </label>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="rounded-lg bg-primary px-3.5 py-2 text-[12px] font-extrabold text-surface transition hover:bg-[#7A180B] disabled:cursor-not-allowed disabled:bg-ink/[0.12] disabled:text-muted"
          >
            {searching ? "Searching…" : "Search"}
          </button>
          {results && (
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-lg px-2.5 py-2 text-[11.5px] font-semibold text-muted transition hover:text-ink"
            >
              Clear
            </button>
          )}
        </form>

        {error && (
          <div className="mb-4 rounded-lg border border-non-veg/30 bg-non-veg/[0.08] px-3.5 py-2.5 text-[12px] font-semibold text-non-veg">
            {error}
          </div>
        )}

        {results ? (
          <SearchResults
            query={submitted}
            allTime={allTime}
            monthLabel={`${MONTH_NAMES[cursor.month - 1]} ${cursor.year}`}
            orders={results}
            onApplied={applyLocal}
            onError={setError}
          />
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <section className="rounded-xl border border-ink/[0.09] bg-surface p-3.5 lg:w-[400px] lg:flex-none">
              <div className="flex items-center gap-2 pb-1">
                <button
                  onClick={() => shiftMonth(-1)}
                  aria-label="Previous month"
                  className="rounded-lg px-2 py-1 text-lg font-bold text-primary transition hover:bg-ink/5"
                >
                  ‹
                </button>
                <span className="flex-1 text-center text-[13.5px] font-extrabold text-ink">
                  {MONTH_NAMES[cursor.month - 1]} {cursor.year}
                </span>
                <button
                  onClick={() => shiftMonth(1)}
                  aria-label="Next month"
                  className="rounded-lg px-2 py-1 text-lg font-bold text-primary transition hover:bg-ink/5"
                >
                  ›
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pb-3">
                <span className="text-[11px] font-semibold text-muted">
                  {monthTotals.count} orders · {money(monthTotals.revenue)}
                </span>
                <button
                  onClick={exportMonth}
                  className="rounded-lg border border-ink/[0.16] px-2.5 py-1 text-[10.5px] font-bold text-ink transition hover:border-primary hover:text-primary"
                >
                  Export month
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 pb-1">
                {WEEKDAYS.map((d, i) => (
                  <span key={i} className="text-center text-[10px] font-bold text-muted">
                    {d}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: dayKeyWeekday(dayKeys[0]) }, (_, i) => (
                  <span key={`pad-${i}`} />
                ))}
                {dayKeys.map((key) => {
                  const stat = stats?.get(key);
                  const selected = key === dayKey;
                  const isToday = key === today;
                  const future = key > today;
                  return (
                    <button
                      key={key}
                      onClick={() => setDayKey(key)}
                      disabled={future}
                      className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 py-1 transition ${
                        selected
                          ? "border-primary bg-primary text-surface"
                          : future
                            ? "border-transparent text-muted/40"
                            : stat
                              ? "border-ink/[0.09] bg-background text-ink hover:border-primary"
                              : "border-transparent text-muted hover:border-ink/20"
                      }`}
                    >
                      <span
                        className={`text-[12px] font-bold ${isToday && !selected ? "text-primary underline" : ""}`}
                      >
                        {Number(key.slice(-2))}
                      </span>
                      {stat && (
                        <>
                          <span className="text-[9px] font-bold opacity-80">{stat.count}</span>
                          <span className="text-[8.5px] font-semibold opacity-70">
                            {Math.round(stat.revenue).toLocaleString("en-IN")}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              {stats === null && !error && (
                <span className="block pt-3 text-center text-[11px] text-muted">Loading month…</span>
              )}
            </section>

            <section className="min-w-0 flex-1">
              {!dayKey ? (
                <div className="rounded-xl border border-dashed border-ink/20 px-5 py-12 text-center text-[12.5px] text-muted">
                  Pick a date to see that day&apos;s orders.
                </div>
              ) : (
                <DayPanel
                  dayKey={dayKey}
                  isToday={dayKey === today}
                  orders={dayOrders}
                  onApplied={applyLocal}
                  onError={setError}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function DayPanel({
  dayKey,
  isToday,
  orders,
  onApplied,
  onError,
}: {
  dayKey: string;
  isToday: boolean;
  orders: OrderWithItems[] | null;
  onApplied: (id: string, patch: Partial<OrderRow>) => void;
  onError: (m: string) => void;
}) {
  if (orders === null) {
    return <div className="px-1 py-8 text-[12.5px] text-muted">Loading day…</div>;
  }

  const summary = summarizeDay(orders);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[19px] text-primary">{longDate(dayKey)}</span>
        {isToday && (
          <span className="rounded-full border border-secondary/45 bg-secondary/[0.18] px-2.5 py-1 text-[10px] font-bold text-[#8B6C08]">
            TODAY · IN PROGRESS
          </span>
        )}
        {orders.length > 0 && (
          <button
            onClick={() => downloadCsv(`golden-city-${dayKey}.csv`, toCsv(orders))}
            className="ml-auto rounded-lg border border-ink/[0.16] px-2.5 py-1.5 text-[11px] font-bold text-ink transition hover:border-primary hover:text-primary"
          >
            Export CSV
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Orders" value={String(summary.count)} />
        <Stat label="Gross revenue" value={money(summary.revenue)} />
      </div>

      {summary.count > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Split title="BY SOURCE" rows={summary.bySource} />
          <Split title="BY PAYMENT" rows={summary.byPayment} />
        </div>
      )}

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 px-5 py-10 text-center text-[12.5px] text-muted">
          No orders on this day.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {orders.map((o) => (
            <HistoryOrderCard key={o.id} order={o} onApplied={onApplied} onError={onError} />
          ))}
        </div>
      )}
    </div>
  );
}

function SearchResults({
  query,
  allTime,
  monthLabel,
  orders,
  onApplied,
  onError,
}: {
  query: string;
  allTime: boolean;
  monthLabel: string;
  orders: OrderWithItems[];
  onApplied: (id: string, patch: Partial<OrderRow>) => void;
  onError: (m: string) => void;
}) {
  const totals = dishTotals(orders, query);
  const byDay = new Map<string, OrderWithItems[]>();
  for (const o of orders) {
    const key = businessDayKey(new Date(o.created_at).getTime());
    byDay.set(key, [...(byDay.get(key) ?? []), o]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-ink/[0.09] bg-surface p-4">
        <span className="text-[11px] font-bold tracking-[.12em] text-muted">
          “{query}” · {allTime ? "ALL TIME" : monthLabel.toUpperCase()}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 pt-2">
          <span className="text-[22px] font-extrabold text-ink">
            {totals.qty}
            <span className="pl-1.5 text-[12px] font-semibold text-muted">sold</span>
          </span>
          <span className="text-[22px] font-extrabold text-ink">
            {money(totals.revenue)}
            <span className="pl-1.5 text-[12px] font-semibold text-muted">earned</span>
          </span>
          <span className="text-[12px] font-semibold text-muted">across {orders.length} orders</span>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 px-5 py-10 text-center text-[12.5px] text-muted">
          No orders matched. Try the “All time” toggle, or a shorter word.
        </div>
      ) : (
        [...byDay.entries()].map(([key, dayOrders]) => (
          <div key={key} className="flex flex-col gap-2">
            <span className="pt-1 text-[12px] font-extrabold text-primary">{longDate(key)}</span>
            {dayOrders.map((o) => (
              <HistoryOrderCard
                key={o.id}
                order={o}
                highlight={query}
                onApplied={onApplied}
                onError={onError}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink/[0.09] bg-surface px-3.5 py-2.5">
      <span className="block text-[10px] font-bold tracking-[.12em] text-muted">{label.toUpperCase()}</span>
      <span className="block pt-1 text-[17px] font-extrabold text-ink">{value}</span>
    </div>
  );
}

function Split({ title, rows }: { title: string; rows: { label: string; count: number; revenue: number }[] }) {
  return (
    <div className="rounded-xl border border-ink/[0.09] bg-surface px-3.5 py-2.5">
      <span className="block pb-1.5 text-[10px] font-bold tracking-[.12em] text-muted">{title}</span>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline gap-2 text-[12px]">
            <span className="font-semibold text-ink">{r.label}</span>
            <span className="text-[10.5px] text-muted">×{r.count}</span>
            <span className="ml-auto font-extrabold text-ink">{money(r.revenue)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryOrderCard({
  order,
  highlight,
  onApplied,
  onError,
}: {
  order: OrderWithItems;
  highlight?: string;
  onApplied: (id: string, patch: Partial<OrderRow>) => void;
  onError: (m: string) => void;
}) {
  const voided = order.status === "cancelled";
  const status = STATUS_STYLE[order.status];
  const needle = highlight?.trim().toLowerCase();

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border border-ink/[0.09] bg-surface p-3.5 ${
        voided ? "opacity-55" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-[7px] px-2.5 py-1.5 text-[11px] font-extrabold ${
            isTableSource(order.source) ? "bg-tertiary text-surface" : "bg-primary text-surface"
          }`}
        >
          {sourceLabel(order.source)}
        </span>
        <span className="text-[10px] font-bold tracking-[.08em] text-muted">
          {order.id.slice(0, 8).toUpperCase()}
        </span>
        <span className="text-[11px] font-semibold text-muted">{istTime(order.created_at)}</span>
        <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${status.className}`}>
          {status.label}
        </span>
        <span className="text-[10.5px] font-semibold text-muted">
          {order.placed_by === "manager" ? "Counter" : "Guest"}
        </span>
        <span className="ml-auto text-[14px] font-extrabold text-ink">
          {money(orderTotal(order.order_items))}
        </span>
      </div>

      <div className={`flex flex-col gap-1 border-t border-dashed border-ink/[0.14] pt-2 ${voided ? "line-through" : ""}`}>
        {order.order_items.map((it) => {
          const matched = needle && it.item_name.toLowerCase().includes(needle);
          return (
            <div key={it.id} className="flex items-baseline gap-2 text-[12px]">
              <span className="min-w-5 font-extrabold text-primary">{it.quantity}×</span>
              <span className={matched ? "font-extrabold text-ink" : "font-semibold text-ink"}>
                {it.item_name}
                {it.variant_name ? ` (${it.variant_name})` : ""}
              </span>
              <span className="ml-auto text-[11px] font-semibold text-muted">
                {money(it.unit_price * it.quantity)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-ink/[0.14] pt-2">
        <span className="text-[10px] font-bold tracking-[.12em] text-muted">
          {paymentLabel(order.payment_method, order.payment_status).toUpperCase()}
        </span>
        <div className="ml-auto">
          <OrderActions
            order={order}
            onApplied={(patch) => onApplied(order.id, patch)}
            onError={onError}
            showPaymentStatus={false}
          />
        </div>
      </div>
    </div>
  );
}
