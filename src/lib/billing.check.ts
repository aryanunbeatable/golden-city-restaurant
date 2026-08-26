// Runnable self-check: node --experimental-strip-types src/lib/billing.check.ts
import assert from "node:assert/strict";
import {
  billItemCount,
  billTotal,
  combinedLines,
  findByToken,
  isUnpaid,
  otherUnpaid,
  staleDateLabel,
  staleUnpaid,
  tableBill,
  tokenOf,
} from "./billing.ts";
import type {
  OrderItemRow,
  OrderStatus,
  OrderWithItems,
  PaymentMethod,
  PaymentStatus,
} from "../types/order.ts";

let seq = 0;
function item(name: string, qty: number, price: number): OrderItemRow {
  return {
    id: `i${seq++}`,
    order_id: "o",
    item_name: name,
    item_name_hi: null,
    variant_name: null,
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
    id: `${String(seq++).padStart(8, "a")}-0000-0000-0000-000000000000`,
    source: "table_1",
    placed_by: "customer",
    status: "served" as OrderStatus,
    estimated_prep_minutes: 10,
    created_at: "2026-08-25T14:00:00+05:30",
    confirmed_at: null,
    ready_at: null,
    served_at: null,
    payment_method: null as PaymentMethod | null,
    payment_status: "pending" as PaymentStatus,
    service_type: null,
    scheduled_for: null,
    customer_name: null,
    party_size: null,
    payment_reference: null,
    razorpay_order_id: null,
    leave_notified_at: null,
    refunded_at: null,
    ...over,
  };
}

// --- the whole point of this page -------------------------------------------
// A served order still owes money. The orders board hides `served` behind
// isLive(), which is why a table could be cleared without anyone collecting.
assert.equal(
  isUnpaid(
    order({ status: "served", payment_status: "pending", order_items: [] }),
  ),
  true,
  "served but unpaid is exactly what billing exists to catch",
);
assert.equal(
  isUnpaid(
    order({ status: "ready", payment_status: "pending", order_items: [] }),
  ),
  true,
  "ready and unpaid is owed too",
);
assert.equal(
  isUnpaid(
    order({ status: "served", payment_status: "paid", order_items: [] }),
  ),
  false,
  "paid is settled, whatever the kitchen thinks",
);
// A voided order is not owed, and an abandoned checkout was never an order.
assert.equal(
  isUnpaid(order({ status: "cancelled", order_items: [] })),
  false,
  "voided is not owed",
);
assert.equal(
  isUnpaid(order({ status: "awaiting_payment", order_items: [] })),
  false,
  "an abandoned online checkout must never reach a bill",
);

// --- combining a table's rounds into one bill --------------------------------
const round1 = order({
  source: "table_2",
  created_at: "2026-08-25T14:00:00+05:30",
  order_items: [item("Veg Biryani", 2, 200)],
});
const round2 = order({
  source: "table_2",
  created_at: "2026-08-25T14:30:00+05:30",
  order_items: [item("Hot Coffee", 1, 49), item("Water Bottle (500ml)", 2, 10)],
});
const otherTable = order({
  source: "table_3",
  order_items: [item("Dal", 1, 150)],
});
const alreadyPaid = order({
  source: "table_2",
  payment_status: "paid",
  payment_method: "counter_cash",
  order_items: [item("Paid Thing", 1, 999)],
});
const voided = order({
  source: "table_2",
  status: "cancelled",
  order_items: [item("Voided", 1, 500)],
});

const all = [round2, round1, otherTable, alreadyPaid, voided];
const bill = tableBill(all, "table_2");

assert.equal(
  bill.total,
  400 + 49 + 20,
  "both unpaid rounds roll into one total",
);
assert.equal(
  bill.itemCount,
  2 + 1 + 2,
  "and every unit is counted, bottles included",
);
assert.equal(
  bill.orders.length,
  2,
  "the paid round and the voided one are not owed",
);
assert.deepEqual(
  bill.orders.map((o) => o.created_at),
  ["2026-08-25T14:00:00+05:30", "2026-08-25T14:30:00+05:30"],
  "oldest first — the round they sat down with reads at the top",
);

// A table nobody is sitting at owes nothing, and must not crash on the way there.
const empty = tableBill(all, "table_4");
assert.equal(empty.total, 0);
assert.equal(empty.itemCount, 0);
assert.deepEqual(empty.orders, []);

// Cross-table bleed would take money off the wrong guest — worth pinning.
assert.equal(
  tableBill(all, "table_3").total,
  150,
  "table 3 owes only its own food",
);

// --- token lookup ------------------------------------------------------------
const parcel = order({ source: "parcel", order_items: [item("Roti", 4, 20)] });
assert.equal(
  tokenOf(parcel),
  parcel.id.slice(0, 8).toUpperCase(),
  "token matches every other screen",
);

const token = tokenOf(parcel);
assert.equal(findByToken([parcel], token).length, 1, "full token matches");
assert.equal(
  findByToken([parcel], token.toLowerCase()).length,
  1,
  "case does not matter at the counter",
);
assert.equal(
  findByToken([parcel], token.slice(2, 6)).length,
  1,
  "a middle fragment matches — first char is misread most",
);
assert.equal(
  findByToken([parcel], " " + token + " ").length,
  1,
  "stray whitespace is forgiven",
);
assert.equal(
  findByToken([parcel], "Z").length,
  0,
  "one character is too loose to search on",
);
assert.equal(
  findByToken([parcel], "ZZZZ").length,
  0,
  "no match returns nothing",
);

// A token that was already settled must say "paid", not "not found".
const settled = order({
  source: "parcel",
  payment_status: "paid",
  payment_method: "counter_cash",
  order_items: [],
});
assert.equal(
  findByToken([settled], tokenOf(settled)).length,
  1,
  "paid orders are still findable by token",
);
// but an abandoned checkout is not a real order and stays invisible.
const abandoned = order({ status: "awaiting_payment", order_items: [] });
assert.equal(
  findByToken([abandoned], tokenOf(abandoned)).length,
  0,
  "abandoned checkouts are not findable",
);

// --- non-table unpaid --------------------------------------------------------
const swiggy = order({
  source: "swiggy",
  payment_status: "pending",
  order_items: [item("X", 1, 100)],
});
const others = otherUnpaid([parcel, swiggy, round1, settled]);
assert.deepEqual(
  others.map((o) => o.source),
  ["parcel"],
  "tables, aggregators and paid orders all excluded",
);

// billTotal/billItemCount over nothing must be 0, not NaN — an empty tile
// renders these directly.
assert.equal(billTotal([]), 0);
assert.equal(billItemCount([]), 0);

// --- combining two rounds into one bill's line items -------------------------
const combined = combinedLines([round1, round2]);
const coffee = combined.find((l) => l.name === "Hot Coffee");
const biryani = combined.find((l) => l.name === "Veg Biryani");
const water = combined.find((l) => l.name === "Water Bottle (500ml)");
assert.equal(
  combined.length,
  3,
  "three distinct name+price lines across both rounds",
);
assert.equal(biryani?.qty, 2);
assert.equal(coffee?.qty, 1);
assert.equal(water?.qty, 2);

// Same name, different price (a menu change mid-shift) must stay two lines —
// merging them would hide which round paid which price.
const cheapSoup = order({ order_items: [item("Veg Soup", 1, 119)] });
const pricierSoup = order({ order_items: [item("Veg Soup", 1, 129)] });
const bothPrices = combinedLines([cheapSoup, pricierSoup]);
assert.equal(
  bothPrices.length,
  2,
  "a price change must not merge into one line",
);

// --- stale unpaid orders (from before today's business day) -----------------
const cutoffMs = new Date("2026-08-25T04:00:00+05:30").getTime();
const yesterdayUnpaidTable = order({
  source: "table_1",
  created_at: "2026-08-24T21:00:00+05:30",
  order_items: [item("Forgotten Biryani", 1, 220)],
});
const todayUnpaidTable = order({
  source: "table_1",
  created_at: "2026-08-25T14:00:00+05:30",
  order_items: [item("Fresh Order", 1, 100)],
});
const yesterdayPaid = order({
  source: "parcel",
  created_at: "2026-08-24T21:00:00+05:30",
  payment_status: "paid",
  payment_method: "counter_cash",
  order_items: [item("Already Settled", 1, 50)],
});
const yesterdayVoided = order({
  source: "table_2",
  status: "cancelled",
  created_at: "2026-08-24T21:00:00+05:30",
  order_items: [item("Voided Old", 1, 999)],
});
const rightAtCutoff = order({
  source: "table_3",
  created_at: "2026-08-25T04:00:00+05:30",
  order_items: [item("Exactly On Time", 1, 60)],
});

const stale = staleUnpaid(
  [
    yesterdayUnpaidTable,
    todayUnpaidTable,
    yesterdayPaid,
    yesterdayVoided,
    rightAtCutoff,
  ],
  cutoffMs,
);
assert.deepEqual(
  stale.map((o) => o.order_items[0].item_name),
  ["Forgotten Biryani"],
  "only the unpaid order from before the cutoff — today's, paid, voided, and exactly-at-cutoff are all excluded",
);

// Deliberately a table source and still returned individually — unlike
// otherUnpaid(), a stale order is never excluded for being on a table, since
// it must never be silently folded into that table's tile either.
assert.equal(stale[0].source, "table_1");

assert.deepEqual(
  staleUnpaid([], cutoffMs),
  [],
  "no stale orders must not crash on the way to an empty list",
);

// A real date, not since()'s "Xm Ys ago" reading as nonsense days out.
assert.equal(staleDateLabel("2026-08-24T21:00:00+05:30"), "24 Aug");

console.log("billing.check.ts: all assertions passed");
