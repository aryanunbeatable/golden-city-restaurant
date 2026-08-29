// Runnable self-check: node --experimental-strip-types src/lib/popular.check.ts
//
// Runs against the REAL menu.json rather than a fixture on purpose. The join
// back to the menu is by name string, so a rename in menu.json silently zeroes
// that dish's ranking in production — here it fails this check instead.
import assert from "node:assert/strict";
import menuJson from "../data/menu.json" with { type: "json" };
import {
  GATE_MIN_ITEMS,
  GATE_MIN_ORDERS,
  MAX_TILES,
  gateOpen,
  leastOrderedCategoryId,
  popularEntries,
  rankPopular,
  windowStart,
  type PopularRow,
} from "./popular.ts";
import type { Menu } from "../types/menu.ts";

const menu = menuJson as Menu;

function row(item_name: string, variant_name: string | null, order_count: number): PopularRow {
  return { item_name, variant_name, order_count };
}

// Names this check leans on must still exist, or every assertion below is
// vacuously passing against a menu that has moved on.
const names = menu.categories.flatMap((c) => c.items).map((i) => i.name);
for (const n of ["Veg Soup", "Manchow Soup", "Paneer 65", "Water Bottle (500ml)", "Tandoori Roti"]) {
  assert.ok(names.includes(n), `menu.json no longer has "${n}" — this check needs updating`);
}

// --- the gate ---------------------------------------------------------------
// Enough distinct dishes, but none of them ordered often enough.
const thin = Array.from({ length: 20 }, (_, i) => row(names[i], null, GATE_MIN_ORDERS - 1));
assert.equal(gateOpen(menu, thin), false, "under the per-dish minimum, the gate stays shut");

// Enough orders each, but not enough distinct dishes.
const narrow = Array.from({ length: GATE_MIN_ITEMS - 1 }, (_, i) => row(names[i], null, 50));
assert.equal(gateOpen(menu, narrow), false, "too few distinct dishes, the gate stays shut");

// Exactly at the bar, both ways.
const atBar = Array.from({ length: GATE_MIN_ITEMS }, (_, i) => row(names[i], null, GATE_MIN_ORDERS));
assert.equal(gateOpen(menu, atBar), true, "at the bar the gate opens");

// A dish split across its variants counts as one dish with the orders summed —
// 2 + 2 is four orders, not two twos that each miss the minimum.
const split = [
  ...Array.from({ length: GATE_MIN_ITEMS - 1 }, (_, i) => row(names[i], null, GATE_MIN_ORDERS)),
  row("Paneer 65", "Half", 2),
  row("Paneer 65", "Full", 2),
];
assert.equal(gateOpen(menu, split), true, "variants of one dish sum toward the gate");

// Water can never help open the gate.
const water = Array.from({ length: GATE_MIN_ITEMS }, () => row("Water Bottle (500ml)", null, 99));
assert.equal(gateOpen(menu, water), false, "counter items are invisible to the gate");

// --- ranking ----------------------------------------------------------------
const ranking = rankPopular(menu, [
  row("Water Bottle (500ml)", null, 500), // sold constantly, must never appear
  row("Tandoori Roti", null, 40),
  row("Paneer 65", "Half", 30),
  row("Paneer 65", "Full", 25), // same dish, must not take a second slot
  row("Manchow Soup", "Non-Veg", 20),
  row("Veg Soup", null, 10),
  row("A Dish That Was Renamed", null, 999), // unmatched, must be dropped
  row("Manchow Soup", "Chicken", 998), // variant the menu doesn't have
]);

assert.deepEqual(
  ranking.map((e) => e.item.name),
  ["Tandoori Roti", "Paneer 65", "Manchow Soup", "Veg Soup"],
  "water, renames, stale variants and the duplicate dish are all gone",
);
assert.equal(ranking[1].variant?.name, "Half", "the dish keeps its best-selling variant");
assert.equal(ranking[2].variant?.name, "Non-Veg");
assert.equal(ranking[3].variant, null, "a variant-less dish resolves to no variant");

// Breads stay eligible — a one-tap roti is genuinely useful at the counter,
// and frequency (not units) is what keeps it from burying the mains.
assert.equal(ranking[0].item.name, "Tandoori Roti");

// Every surviving entry can be priced, or the tile cannot render.
for (const e of ranking) {
  const price = e.variant ? e.variant.price : e.item.price;
  assert.equal(typeof price, "number", `${e.item.name} has no price to show`);
}

// Never more tiles than the strip is built for.
const flood = names.slice(0, 40).map((n, i) => row(n, null, 100 - i));
assert.equal(rankPopular(menu, flood).length, MAX_TILES);

// Ties break on name, so the same data can't render in a different order on
// two devices.
const tied = [row("Veg Soup", null, 5), row("Tandoori Roti", null, 5)];
assert.deepEqual(
  rankPopular(menu, tied).map((e) => e.item.name),
  ["Tandoori Roti", "Veg Soup"],
);

// --- the two combined -------------------------------------------------------
// The whole point of the gate: real ranking data, but not enough of it, shows
// nothing rather than a fabricated bestseller list.
assert.deepEqual(popularEntries(menu, ranking.map((e) => row(e.item.name, null, 9)), thin), []);
assert.ok(popularEntries(menu, [row("Veg Soup", null, 5)], atBar).length > 0);

// --- window -----------------------------------------------------------------
const now = Date.parse("2026-08-27T00:00:00Z");
assert.equal(windowStart(now).toISOString(), "2026-07-28T00:00:00.000Z");

// --- least-ordered category --------------------------------------------------
// Desserts is a real category with exactly one item (Gulab Jamun) — give
// every OTHER category an order and leave Desserts untouched, so it is the
// unique minimum regardless of menu.categories' own ordering.
const oneOrderPerOtherCategory: PopularRow[] = [
  "Veg Soup",
  "Fresh Lime Soda",
  "Paneer 65",
  "Noodles",
  "Paneer Tikka 08 Pcs",
  "Green Salad",
  "Chicken",
  "Golden Veg Thali",
  "Paneer Handi",
  "Dal Fry",
  "Chicken Punjabi Curry",
  "Tawa Roti",
  "Jeera Rice",
  "Vanilla",
].map((n) => row(n, null, 5));
assert.equal(
  leastOrderedCategoryId(menu, oneOrderPerOtherCategory),
  "desserts",
  "the only category with zero resolved orders is the least-ordered one",
);

// No data at all still returns a stable id rather than null or a crash — the
// caller (menu nav) always needs a category to fall back to.
assert.equal(leastOrderedCategoryId(menu, []), menu.categories[0].id);

console.log("popular.check.ts: all assertions passed");
