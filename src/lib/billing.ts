// Counter billing — who still owes money, and how much.
//
// Pure (no Supabase, no React) so it stays runnable under
// `node --experimental-strip-types`; see billing.check.ts. Relative imports
// with extensions exist for that reason.
//
// The one idea worth holding on to: billing keys off PAYMENT status, never
// kitchen status. isLive() on the orders board drops `served`, so a table
// whose food has gone out disappears from that screen whether or not anyone
// took the money. That is exactly the order this page must keep showing.
import { orderTotal } from "./history-report.ts";
import {
  isTableSource,
  type OrderSource,
  type OrderWithItems,
} from "../types/order.ts";

const STALE_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
});

/** Every table, in the order they appear on the counter's tiles. */
export const TABLE_SOURCES: readonly OrderSource[] = [
  "table_1",
  "table_2",
  "table_3",
  "table_4",
];

/**
 * Does this order still owe money?
 *
 * `awaiting_payment` is excluded because an abandoned online checkout is not
 * an order at all — it never reached the kitchen and nobody is sitting at a
 * table waiting to pay for it. `cancelled` is excluded because a voided order
 * is not owed. Everything else is fair game, INCLUDING `served`.
 */
export function isUnpaid(order: OrderWithItems): boolean {
  if (order.status === "cancelled" || order.status === "awaiting_payment")
    return false;
  return order.payment_status === "pending";
}

/** Rupees owed across a set of orders. */
export function billTotal(orders: OrderWithItems[]): number {
  return orders.reduce((sum, o) => sum + orderTotal(o.order_items), 0);
}

/** Dishes and bottles owed across a set of orders. */
export function billItemCount(orders: OrderWithItems[]): number {
  return orders.reduce(
    (sum, o) => sum + o.order_items.reduce((n, it) => n + it.quantity, 0),
    0,
  );
}

export interface TableBill {
  source: OrderSource;
  /** Oldest first — the order the table sat down with reads at the top. */
  orders: OrderWithItems[];
  total: number;
  itemCount: number;
}

/**
 * One table's bill: every unpaid order on it rolled together.
 *
 * A table that orders a second round of drinks has two order rows but settles
 * once, so the counter is shown one number. Empty `orders` means the table
 * owes nothing — either nobody is sitting there or they have already paid.
 */
export function tableBill(
  orders: OrderWithItems[],
  source: OrderSource,
): TableBill {
  const mine = orders
    .filter((o) => o.source === source && isUnpaid(o))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    source,
    orders: mine,
    total: billTotal(mine),
    itemCount: billItemCount(mine),
  };
}

/** Every table's bill, tiles included when they owe nothing. */
export function tableBills(orders: OrderWithItems[]): TableBill[] {
  return TABLE_SOURCES.map((t) => tableBill(orders, t));
}

export interface BillLine {
  name: string;
  qty: number;
  unitPrice: number;
}

/**
 * A table's separate rounds shown as one bill, not several. Two orders each
 * for "Hot Coffee" become one line of qty 2 — a guest reading the bill over
 * the counter's shoulder should not have to add the same dish twice.
 *
 * Keyed on name+price rather than name alone: a price change between rounds
 * (a menu update mid-shift) must not silently merge two different prices into
 * one line at whichever price happened to be seen first.
 */
export function combinedLines(orders: OrderWithItems[]): BillLine[] {
  const byKey = new Map<string, BillLine>();
  for (const o of orders) {
    for (const it of o.order_items) {
      const key = `${it.item_name}::${it.unit_price}`;
      const existing = byKey.get(key);
      if (existing) existing.qty += it.quantity;
      else
        byKey.set(key, {
          name: it.item_name,
          qty: it.quantity,
          unitPrice: it.unit_price,
        });
    }
  }
  return [...byKey.values()];
}

/** The token printed on a slip: first 8 of the uuid, uppercased. Must match
 *  how every other screen renders it. */
export function tokenOf(order: { id: string }): string {
  return order.id.slice(0, 8).toUpperCase();
}

/**
 * Token lookup for everything that is not a table — parcel, Swiggy/Zomato, a
 * phone order collected at the counter.
 *
 * Matches on any part of the token, not just the start: staff read these off
 * a slip and the first character is the one most often misread. Paid orders
 * are deliberately still returned, so searching a token the guest already
 * settled says "already paid" instead of "no such order" — the counter needs
 * to tell those two apart.
 */
export function findByToken(
  orders: OrderWithItems[],
  query: string,
): OrderWithItems[] {
  const needle = query.trim().toUpperCase();
  if (needle.length < 2) return [];
  return orders
    .filter(
      (o) => o.status !== "awaiting_payment" && tokenOf(o).includes(needle),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Unpaid orders that aren't on a table — parcel and the aggregators. Shown as
 * a list under the tiles so they can't be forgotten simply because no tile
 * represents them.
 *
 * Swiggy and Zomato are excluded: the platform settles those, so they are
 * never owed at the counter and would sit here forever.
 */
export function otherUnpaid(orders: OrderWithItems[]): OrderWithItems[] {
  return orders
    .filter(
      (o) =>
        isUnpaid(o) &&
        !isTableSource(o.source) &&
        o.source !== "swiggy" &&
        o.source !== "zomato",
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Unpaid orders from before today's business day.
 *
 * Both the table tiles and today's "Unpaid — parcel & walk-ins" list are
 * scoped to today, same as Active orders — once the day rolls over, an order
 * still unpaid falls out of both and would otherwise have no UI left able to
 * collect it. This is that catch-all: every source, listed individually.
 *
 * Deliberately never folded into a table's tile: a forgotten order on
 * table_1 from three days ago has nothing to do with whoever is sitting at
 * the physical table today, and merging it in would silently inflate a
 * stranger's bill with someone else's forgotten one.
 */
export function staleUnpaid(
  orders: OrderWithItems[],
  cutoffMs: number,
): OrderWithItems[] {
  return orders
    .filter((o) => isUnpaid(o) && new Date(o.created_at).getTime() < cutoffMs)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** "25 Aug" — since() (Xm Ys ago) reads as nonsense once an order is more
 *  than a few hours old, let alone days; a stale row needs an actual date. */
export function staleDateLabel(iso: string): string {
  return STALE_DATE.format(new Date(iso));
}
