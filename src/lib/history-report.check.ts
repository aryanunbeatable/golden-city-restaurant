// Runnable self-check: node --experimental-strip-types src/lib/history-report.check.ts
import assert from "node:assert/strict";
import { dishTotals, orderTotal, summarizeDay, toCsv } from "./history-report.ts";
import type { OrderItemRow, OrderStatus, OrderWithItems, PaymentMethod, PaymentStatus } from "../types/order.ts";

let seq = 0;
function item(name: string, qty: number, price: number, variant: string | null = null): OrderItemRow {
  return {
    id: `i${seq++}`,
    order_id: "o",
    item_name: name,
    item_name_hi: null,
    variant_name: variant,
    variant_name_hi: null,
    quantity: qty,
    unit_price: price,
    is_veg: true,
  };
}

function order(
  over: Partial<OrderWithItems> & { order_items: OrderItemRow[] },
): OrderWithItems {
  return {
    id: `order-${seq++}-aaaaaaaa`,
    source: "table_1",
    placed_by: "customer",
    status: "served" as OrderStatus,
    estimated_prep_minutes: 10,
    created_at: "2026-08-18T14:00:00+05:30",
    confirmed_at: null,
    ready_at: null,
    served_at: null,
    payment_method: "counter_cash" as PaymentMethod | null,
    payment_status: "paid" as PaymentStatus,
    service_type: null,
    scheduled_for: null,
    customer_name: null,
    payment_reference: null,
    refunded_at: null,
    ...over,
  };
}

// --- orderTotal ---
assert.equal(orderTotal([item("Roti", 4, 15), item("Soup", 1, 119)]), 179);
assert.equal(orderTotal([]), 0, "an order with no items is worth nothing, not NaN");

// --- summarizeDay ---
const day = summarizeDay([
  order({ source: "table_1", payment_method: "counter_cash", order_items: [item("Soup", 1, 100)] }),
  order({ source: "swiggy", payment_method: "swiggy", order_items: [item("Noodles", 2, 150)] }),
  // unsettled: paid-at-counter guest who hasn't paid yet
  order({
    source: "table_2",
    payment_method: null,
    payment_status: "pending",
    order_items: [item("Coffee", 1, 60)],
  }),
  // voided: listed, but must not move any number
  order({ status: "cancelled", source: "table_3", order_items: [item("Biryani", 5, 400)] }),
]);

assert.equal(day.count, 3, "voided order excluded from the count");
assert.equal(day.revenue, 100 + 300 + 60, "voided order excluded from revenue");
assert.equal(day.voided, 1);

// the splits must each add up to gross — that's the whole point of showing them
assert.equal(
  day.bySource.reduce((s, r) => s + r.revenue, 0),
  day.revenue,
  "source split must reconcile to gross",
);
assert.equal(
  day.byPayment.reduce((s, r) => s + r.revenue, 0),
  day.revenue,
  "payment split must reconcile to gross",
);

// an unpaid order lands in its own bucket rather than silently vanishing
const unpaid = day.byPayment.find((r) => r.label === "Unpaid");
assert.ok(unpaid, "unsettled orders need their own payment bucket");
assert.equal(unpaid.revenue, 60);

// source rows follow the fixed option order, not insertion order
assert.deepEqual(
  day.bySource.map((r) => r.label),
  ["Table 1", "Table 2", "Swiggy"],
);

// an empty day is all zeros, not an error
const empty = summarizeDay([]);
assert.equal(empty.count, 0);
assert.equal(empty.revenue, 0);
assert.deepEqual(empty.bySource, []);

// --- dishTotals ---
const searched: OrderWithItems[] = [
  order({ order_items: [item("Paneer Handi", 2, 179, "Half"), item("Tawa Roti", 4, 15)] }),
  order({ order_items: [item("Paneer Handi", 1, 299, "Full")] }),
  // a cancelled order's dishes were never actually sold
  order({ status: "cancelled", order_items: [item("Paneer Handi", 9, 299)] }),
];
const paneer = dishTotals(searched, "paneer");
assert.equal(paneer.qty, 3, "case-insensitive match, cancelled excluded");
assert.equal(paneer.revenue, 2 * 179 + 299, "only the matching lines count, not the whole order");

assert.deepEqual(dishTotals(searched, "pizza"), { qty: 0, revenue: 0 }, "no match is zero, not NaN");

// --- toCsv ---
const csv = toCsv([
  order({
    created_at: "2026-08-19T01:30:00+05:30",
    order_items: [item("Noodles, Hakka", 1, 169)],
  }),
  order({ status: "cancelled", order_items: [item("Soup", 1, 100)] }),
]);
const lines = csv.split("\n");
assert.equal(lines.length, 3, "header + one row per order");
assert.ok(lines[0].startsWith("Token,Kitchen day,Time (IST)"));
// a 1:30am order files under the previous kitchen day in the export too
assert.ok(lines[1].includes("2026-08-18"), "CSV must use the kitchen day, not the calendar date");
// a comma inside a dish name must not become a new column
assert.ok(lines[1].includes('"1x Noodles, Hakka"'), "fields containing commas must be quoted");
assert.ok(lines[2].endsWith(",0"), "a voided order exports as zero revenue");

console.log("history-report.check.ts: all assertions passed");
