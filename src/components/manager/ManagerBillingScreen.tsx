"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { since } from "@/lib/orders";
import { money } from "@/lib/cart";
import {
  businessDayCutoffMs,
  msUntilNextBusinessDay,
} from "@/lib/business-day";
import { COUNTER_ITEMS, isCounterItemName } from "@/lib/counter-items";
import {
  TABLE_SOURCES,
  combinedLines,
  findByToken,
  otherUnpaid,
  tableBill,
  tokenOf,
  type TableBill,
} from "@/lib/billing";
import {
  addCounterItem,
  removeCounterItem,
  settleOrderPayment,
  settleTableBill,
} from "@/app/manager/actions";
import {
  COUNTER_PAYMENT_OPTIONS,
  sourceLabel,
  type OrderItemRow,
  type OrderRow,
  type OrderSource,
  type OrderWithItems,
  type PaymentMethod,
} from "@/types/order";
import { LiveClock } from "@/components/LiveClock";
import { ManagerNav } from "@/components/manager/ManagerNav";

/**
 * Counter billing: who still owes money, and collecting it.
 *
 * Deliberately keyed on PAYMENT status, not kitchen status. The Active
 * orders screen hides `served` orders (isLive() excludes them), so a table
 * whose food already went out can vanish from that screen before anyone
 * collected the bill. This page's queries never apply that filter — a
 * served-but-unpaid table stays on its tile until it is actually paid.
 */
export function ManagerBillingScreen() {
  const [orders, setOrders] = useState<OrderWithItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [openTarget, setOpenTarget] = useState<
    | { kind: "table"; source: OrderSource }
    | { kind: "order"; id: string }
    | null
  >(null);
  const [query, setQuery] = useState("");

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
        .neq("status", "awaiting_payment")
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

  // Same 4AM boundary as every other board — a stale bill from yesterday's
  // shift must not sit on today's table tile.
  useEffect(() => {
    const id = setTimeout(
      () => window.location.reload(),
      msUntilNextBusinessDay(Date.now()),
    );
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
      .channel("manager:billing")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const row = payload.new as OrderRow;
          if (row.status === "awaiting_payment") return;
          supabase
            .from("order_items")
            .select("*")
            .eq("order_id", row.id)
            .then(({ data }) => {
              setOrders((prev) => [
                ...(prev ?? []),
                { ...row, order_items: (data as OrderItemRow[]) ?? [] },
              ]);
            });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload) => {
          const row = payload.new as OrderRow;
          setOrders((prev) => {
            if (!prev) return prev;
            if (prev.some((o) => o.id === row.id)) {
              return prev.map((o) => (o.id === row.id ? { ...o, ...row } : o));
            }
            // A phone order becomes visible the moment payment lands, which
            // arrives as an UPDATE out of awaiting_payment, not an INSERT.
            if (row.status === "awaiting_payment") return prev;
            void supabase
              .from("order_items")
              .select("*")
              .eq("order_id", row.id)
              .then(({ data }) => {
                setOrders((cur) =>
                  cur && !cur.some((o) => o.id === row.id)
                    ? [
                        ...cur,
                        { ...row, order_items: (data as OrderItemRow[]) ?? [] },
                      ]
                    : cur,
                );
              });
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // order_items has no realtime subscription of its own here (only `orders`
  // does), so a bottle just added would otherwise sit correctly in the
  // database but invisibly on screen until a reload.
  function appendItem(orderId: string, item: OrderItemRow) {
    setOrders(
      (prev) =>
        prev?.map((o) =>
          o.id === orderId
            ? { ...o, order_items: [...o.order_items, item] }
            : o,
        ) ?? prev,
    );
  }

  function removeItem(orderId: string, itemRowId: string) {
    setOrders(
      (prev) =>
        prev?.map((o) =>
          o.id === orderId
            ? {
                ...o,
                order_items: o.order_items.filter((it) => it.id !== itemRowId),
              }
            : o,
        ) ?? prev,
    );
  }

  const all = useMemo(() => orders ?? [], [orders]);
  const bills = useMemo(
    () => TABLE_SOURCES.map((t) => tableBill(all, t)),
    [all],
  );
  // The real, complete set — drives the header stats regardless of search.
  const others = useMemo(() => otherUnpaid(all), [all]);
  const searchResults = useMemo(
    () => (query.trim() ? findByToken(all, query) : []),
    [all, query],
  );
  // What the list below actually renders: excludes anything the search is
  // already showing, so a match that is also unpaid does not draw two live
  // BillPanels for the same order at once, each with its own settle buttons.
  const othersToShow = useMemo(() => {
    if (searchResults.length === 0) return others;
    const shown = new Set(searchResults.map((o) => o.id));
    return others.filter((o) => !shown.has(o.id));
  }, [others, searchResults]);

  const owedTables = bills.filter((b) => b.orders.length > 0).length;
  const totalOwed =
    bills.reduce((s, b) => s + b.total, 0) +
    others.reduce((s, o) => s + orderLineTotal(o), 0);

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <ManagerNav active="billing">
        <LiveClock className="text-[11px] font-semibold text-muted" />
      </ManagerNav>

      <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-ink/10 px-4 py-2.5 md:px-6">
        <Stat
          n={owedTables}
          label="tables owe"
          tone={owedTables > 0 ? "alert" : "calm"}
        />
        <Stat
          n={others.length}
          label="parcel / other owe"
          tone={others.length > 0 ? "alert" : "calm"}
        />
        <span className="ml-auto text-[12px] font-extrabold text-ink">
          {money(totalOwed)}
          <span className="pl-1 text-[10.5px] font-semibold text-muted">
            to collect
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {error && (
          <div className="mb-4 rounded-lg border border-non-veg/30 bg-non-veg/[0.08] px-3.5 py-2.5 text-[12px] font-semibold text-non-veg">
            {error}
          </div>
        )}
        {!error && orders === null && (
          <span className="text-[12.5px] text-muted">Loading…</span>
        )}

        {orders !== null && (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2.5">
              <SectionTitle>Tables</SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {bills.map((b) => (
                  <TableBillTile
                    key={b.source}
                    bill={b}
                    open={
                      openTarget?.kind === "table" &&
                      openTarget.source === b.source
                    }
                    onToggle={() =>
                      setOpenTarget(
                        openTarget?.kind === "table" &&
                          openTarget.source === b.source
                          ? null
                          : { kind: "table", source: b.source },
                      )
                    }
                  />
                ))}
              </div>
              {openTarget?.kind === "table" && (
                <BillPanel
                  target={{
                    kind: "table",
                    bill: bills.find((b) => b.source === openTarget.source)!,
                  }}
                  onSettled={() => setOpenTarget(null)}
                  onItemAdded={appendItem}
                  onItemRemoved={removeItem}
                  onError={setError}
                />
              )}
            </section>

            <section className="flex flex-col gap-2.5">
              <SectionTitle>Find a token — parcel, walk-ins</SectionTitle>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type any part of the token…"
                className="w-full max-w-xs rounded-lg border border-ink/[0.16] bg-surface px-3 py-2 text-[13px] font-semibold text-ink outline-none focus:border-primary"
              />
              {query.trim() && (
                <div className="flex flex-col gap-2">
                  {searchResults.length === 0 && (
                    <span className="text-[12px] text-muted">
                      No token matches “{query.trim()}”.
                    </span>
                  )}
                  {searchResults.map((o) => (
                    <div key={o.id} className="flex flex-col gap-2">
                      <button
                        onClick={() =>
                          setOpenTarget(
                            openTarget?.kind === "order" &&
                              openTarget.id === o.id
                              ? null
                              : { kind: "order", id: o.id },
                          )
                        }
                        className={`flex flex-wrap items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                          openTarget?.kind === "order" && openTarget.id === o.id
                            ? "border-primary bg-primary/[0.06]"
                            : "border-ink/[0.12] bg-surface hover:border-primary"
                        }`}
                      >
                        <span className="rounded-[7px] bg-primary px-2.5 py-1.5 text-[11px] font-extrabold text-surface">
                          {sourceLabel(o.source)}
                        </span>
                        <span className="text-[11px] font-bold text-muted">
                          {tokenOf(o)}
                        </span>
                        <span className="text-[12px] font-semibold text-ink">
                          {since(o.created_at, now)}
                        </span>
                        <span className="ml-auto text-[13px] font-extrabold text-ink">
                          {o.payment_status === "paid"
                            ? "Already paid"
                            : money(orderLineTotal(o))}
                        </span>
                      </button>
                      {openTarget?.kind === "order" &&
                        openTarget.id === o.id &&
                        o.payment_status !== "paid" && (
                          <BillPanel
                            target={{ kind: "order", order: o }}
                            onSettled={() => setOpenTarget(null)}
                            onItemAdded={appendItem}
                            onItemRemoved={removeItem}
                            onError={setError}
                          />
                        )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {othersToShow.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <SectionTitle>Unpaid — parcel &amp; walk-ins</SectionTitle>
                {othersToShow.map((o) => (
                  <div key={o.id} className="flex flex-col gap-2">
                    <button
                      onClick={() =>
                        setOpenTarget(
                          openTarget?.kind === "order" && openTarget.id === o.id
                            ? null
                            : { kind: "order", id: o.id },
                        )
                      }
                      className={`flex flex-wrap items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                        openTarget?.kind === "order" && openTarget.id === o.id
                          ? "border-primary bg-primary/[0.06]"
                          : "border-secondary/50 bg-secondary/[0.1] hover:border-primary"
                      }`}
                    >
                      <span className="rounded-[7px] bg-primary px-2.5 py-1.5 text-[11px] font-extrabold text-surface">
                        {sourceLabel(o.source)}
                      </span>
                      <span className="text-[11px] font-bold text-muted">
                        {tokenOf(o)}
                      </span>
                      <span className="text-[12px] font-semibold text-ink">
                        {since(o.created_at, now)}
                      </span>
                      <span className="ml-auto text-[13px] font-extrabold text-ink">
                        {money(orderLineTotal(o))}
                      </span>
                    </button>
                    {openTarget?.kind === "order" && openTarget.id === o.id && (
                      <BillPanel
                        target={{ kind: "order", order: o }}
                        onSettled={() => setOpenTarget(null)}
                        onItemAdded={appendItem}
                        onItemRemoved={removeItem}
                        onError={setError}
                      />
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function orderLineTotal(o: OrderWithItems): number {
  return o.order_items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-bold tracking-[.12em] text-muted">
      {children}
    </span>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: "alert" | "calm";
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span
        className={`text-[15px] font-extrabold ${tone === "alert" ? "text-non-veg" : "text-ink"}`}
      >
        {n}
      </span>
      <span className="text-[10.5px] font-semibold text-muted">{label}</span>
    </span>
  );
}

function TableBillTile({
  bill,
  open,
  onToggle,
}: {
  bill: TableBill;
  open: boolean;
  onToggle: () => void;
}) {
  const label = sourceLabel(bill.source);
  const owes = bill.orders.length > 0;

  return (
    <button
      onClick={onToggle}
      disabled={!owes}
      className={`flex min-h-[86px] flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition ${
        !owes
          ? "border-dashed border-ink/15 bg-transparent"
          : open
            ? "border-primary bg-primary/[0.06]"
            : "border-secondary/60 bg-secondary/[0.12] hover:border-primary"
      }`}
    >
      <span className="text-[11px] font-bold tracking-[.1em] text-muted">
        {label}
      </span>
      {owes ? (
        <>
          <span className="text-lg font-extrabold text-ink">
            {money(bill.total)}
          </span>
          <span className="text-[11px] font-semibold text-muted">
            {bill.itemCount} item{bill.itemCount === 1 ? "" : "s"} ·{" "}
            {bill.orders.length} round
            {bill.orders.length === 1 ? "" : "s"}
          </span>
        </>
      ) : (
        <span className="text-[12px] font-semibold text-muted">
          Nothing owed
        </span>
      )}
    </button>
  );
}

type BillTarget =
  { kind: "table"; bill: TableBill } | { kind: "order"; order: OrderWithItems };

/** The bill itself — line items, a bottle stepper, and the settle buttons.
 *  Shared between a table's combined bill and a single token-search order,
 *  because collecting money works the same way either side of that split. */
function BillPanel({
  target,
  onSettled,
  onItemAdded,
  onItemRemoved,
  onError,
}: {
  target: BillTarget;
  onSettled: () => void;
  onItemAdded: (orderId: string, item: OrderItemRow) => void;
  onItemRemoved: (orderId: string, itemRowId: string) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [bottleQty, setBottleQty] = useState<Record<string, number>>({});

  const orders = target.kind === "table" ? target.bill.orders : [target.order];
  const lines = combinedLines(orders);
  // Individual rows, not merged like `lines` — each Add created its own row,
  // so removal needs to target exactly one of them, which combinedLines()
  // deliberately throws away in favor of a readable qty-per-name summary.
  const bottleRows = orders.flatMap((o) =>
    o.order_items.filter((it) => isCounterItemName(it.item_name)).map((it) => ({ orderId: o.id, item: it })),
  );
  const total =
    target.kind === "table" ? target.bill.total : orderLineTotal(target.order);
  // The order a bottle gets billed against — the most recent round, since
  // that is the one still open. tableBill() sorts oldest-first, so that's
  // the last entry.
  const growOrder = orders[orders.length - 1];

  async function settle(method: PaymentMethod) {
    setBusy(true);
    try {
      const result =
        target.kind === "table"
          ? await settleTableBill(target.bill.source, method)
          : await settleOrderPayment(target.order.id, method);
      if (result.ok) onSettled();
      else onError(result.error ?? "That didn't go through — try again.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addBottle(itemId: string) {
    if (!growOrder) return;
    const qty = bottleQty[itemId] ?? 1;
    setBusy(true);
    try {
      const result = await addCounterItem(growOrder.id, itemId, qty);
      if (result.ok && result.item) onItemAdded(growOrder.id, result.item);
      else if (!result.ok)
        onError(result.error ?? "Couldn't add that — try again.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeBottle(orderId: string, itemRowId: string) {
    setBusy(true);
    try {
      const result = await removeCounterItem(orderId, itemRowId);
      if (result.ok) onItemRemoved(orderId, itemRowId);
      else onError(result.error ?? "Couldn't remove that — try again.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!owesOrHasOrder(target)) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink/[0.12] bg-surface p-3.5">
      <div className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <div
            key={`${l.name}::${l.unitPrice}`}
            className="flex items-center gap-2 text-[12.5px]"
          >
            <span className="min-w-6 font-extrabold text-primary">
              {l.qty}×
            </span>
            <span className="flex-1 font-semibold text-ink">{l.name}</span>
            <span className="font-bold text-muted">
              {money(l.unitPrice * l.qty)}
            </span>
          </div>
        ))}
      </div>

      {bottleRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-ink/[0.14] pt-2.5">
          <span className="text-[10.5px] font-bold tracking-[.1em] text-muted">REMOVE</span>
          {bottleRows.map(({ orderId, item }) => (
            <button
              key={item.id}
              disabled={busy}
              onClick={() => removeBottle(orderId, item.id)}
              className="flex items-center gap-1.5 rounded-lg border border-ink/[0.16] py-1 pl-2.5 pr-1.5 text-[11.5px] font-semibold text-ink transition hover:border-non-veg hover:text-non-veg disabled:opacity-40"
            >
              {item.quantity}× {item.item_name}
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink/[0.08] text-[10px] font-bold">
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      {growOrder && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-ink/[0.14] pt-2.5">
          <span className="text-[10.5px] font-bold tracking-[.1em] text-muted">
            ADD
          </span>
          {COUNTER_ITEMS.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1 rounded-lg border border-ink/[0.16] px-1.5 py-1"
            >
              <span className="pl-1 text-[11.5px] font-semibold text-ink">
                {item.name}
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  setBottleQty((q) => ({
                    ...q,
                    [item.id]: Math.max(1, (q[item.id] ?? 1) - 1),
                  }))
                }
                className="flex h-5 w-5 items-center justify-center text-xs font-bold text-primary disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-3 text-center text-[11px] font-extrabold text-primary">
                {bottleQty[item.id] ?? 1}
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  setBottleQty((q) => ({
                    ...q,
                    [item.id]: Math.min(20, (q[item.id] ?? 1) + 1),
                  }))
                }
                className="flex h-5 w-5 items-center justify-center text-xs font-bold text-primary disabled:opacity-40"
              >
                +
              </button>
              <button
                disabled={busy}
                onClick={() => addBottle(item.id)}
                className="ml-1 rounded-md bg-primary px-2 py-1 text-[10.5px] font-extrabold text-surface disabled:opacity-50"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-dashed border-ink/[0.14] pt-2.5">
        <span className="text-xs font-semibold text-muted">
          Total to collect
        </span>
        <span className="text-lg font-extrabold text-ink">{money(total)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {COUNTER_PAYMENT_OPTIONS.map((p) => (
          <button
            key={p.value}
            disabled={busy}
            onClick={() => settle(p.value)}
            className="flex-1 rounded-lg bg-primary py-2.5 text-[12.5px] font-extrabold text-surface transition hover:bg-[#7A180B] disabled:opacity-50"
          >
            Collected — {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function owesOrHasOrder(target: BillTarget): boolean {
  return target.kind === "table" ? target.bill.orders.length > 0 : true;
}
