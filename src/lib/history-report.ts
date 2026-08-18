// Pure reporting logic — no Supabase, no React — so it stays runnable under
// `node --experimental-strip-types` (see history-report.check.ts). Relative
// imports with extensions exist for that reason.
import { businessDayKey } from "./business-day.ts";
import {
  ORDER_SOURCE_OPTIONS,
  PAYMENT_METHOD_LABELS,
  paymentLabel,
  sourceLabel,
  type OrderItemRow,
  type OrderSource,
  type OrderWithItems,
  type PaymentMethod,
} from "../types/order.ts";

export interface DayStat {
  count: number;
  revenue: number;
}

// The bill is always derived from the line items, never stored on the order:
// unit_price is snapshotted at order time, so a later menu price change can't
// retroactively rewrite last month's revenue.
export function orderTotal(items: OrderItemRow[]): number {
  return items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);
}

/** How many of a matching dish were sold, and what they earned. Counts only
 *  the matching lines, not the whole order they arrived in. */
export function dishTotals(orders: OrderWithItems[], query: string): { qty: number; revenue: number } {
  const needle = query.trim().toLowerCase();
  let qty = 0;
  let revenue = 0;
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const it of o.order_items) {
      if (!it.item_name.toLowerCase().includes(needle)) continue;
      qty += it.quantity;
      revenue += it.quantity * it.unit_price;
    }
  }
  return { qty, revenue };
}

export interface DaySummary {
  count: number;
  revenue: number;
  bySource: { label: string; count: number; revenue: number }[];
  byPayment: { label: string; count: number; revenue: number }[];
  voided: number;
}

/** Voided orders are listed but never counted — a mis-punched token must not
 *  move the day's numbers. Unsettled orders get their own payment bucket so
 *  the split always adds up to gross. */
export function summarizeDay(orders: OrderWithItems[]): DaySummary {
  const live = orders.filter((o) => o.status !== "cancelled");
  const bySource = new Map<OrderSource, DayStat>();
  const byPayment = new Map<PaymentMethod | "pending", DayStat>();

  for (const o of live) {
    const total = orderTotal(o.order_items);
    const s = bySource.get(o.source) ?? { count: 0, revenue: 0 };
    bySource.set(o.source, { count: s.count + 1, revenue: s.revenue + total });

    const key: PaymentMethod | "pending" =
      o.payment_status === "paid" && o.payment_method ? o.payment_method : "pending";
    const p = byPayment.get(key) ?? { count: 0, revenue: 0 };
    byPayment.set(key, { count: p.count + 1, revenue: p.revenue + total });
  }

  return {
    count: live.length,
    revenue: live.reduce((sum, o) => sum + orderTotal(o.order_items), 0),
    voided: orders.length - live.length,
    // Fixed option order, so rows don't reshuffle between days.
    bySource: ORDER_SOURCE_OPTIONS.filter((s) => bySource.has(s.value)).map((s) => ({
      label: s.label,
      ...bySource.get(s.value)!,
    })),
    byPayment: ([...Object.keys(PAYMENT_METHOD_LABELS), "pending"] as (PaymentMethod | "pending")[])
      .filter((k) => byPayment.has(k))
      .map((k) => ({
        label: k === "pending" ? "Unpaid" : PAYMENT_METHOD_LABELS[k],
        ...byPayment.get(k)!,
      })),
  };
}

const IST_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function istTime(iso: string): string {
  return IST_TIME.format(new Date(iso));
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(orders: OrderWithItems[]): string {
  const header = [
    "Token",
    "Kitchen day",
    "Time (IST)",
    "Source",
    "Placed by",
    "Status",
    "Payment",
    "Items",
    "Total",
  ];
  const rows = orders.map((o) => [
    o.id.slice(0, 8).toUpperCase(),
    businessDayKey(new Date(o.created_at).getTime()),
    istTime(o.created_at),
    sourceLabel(o.source),
    o.placed_by,
    o.status,
    paymentLabel(o.payment_method, o.payment_status),
    o.order_items
      .map((it) => `${it.quantity}x ${it.item_name}${it.variant_name ? ` (${it.variant_name})` : ""}`)
      .join("; "),
    o.status === "cancelled" ? 0 : orderTotal(o.order_items),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}
