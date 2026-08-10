// Runnable self-check: node --experimental-strip-types src/lib/cart.check.ts
import assert from "node:assert/strict";
import { addToCart, bumpCart, cartTotals, decorateItem, lineFromItem, lineKey, lineLabel } from "./cart.ts";
import type { MenuItem } from "../types/menu.ts";

const noodles: MenuItem = {
  id: "noodles",
  name: "Noodles",
  description: "",
  variants: [
    { name: "Veg", price: 169, veg: true, nameHi: "वेज" },
    { name: "Chicken", price: 209, veg: false, nameHi: "चिकन" },
  ],
  prepTimeMinutes: 16,
  photo: "placeholder",
  nameHi: "नूडल्स",
};

const soup: MenuItem = {
  id: "veg-soup",
  name: "Veg Soup",
  description: "",
  price: 119,
  veg: true,
  prepTimeMinutes: 10,
  photo: "placeholder",
  nameHi: "वेज सूप",
};

// decorateItem: mixed-veg variant item shows both dots, price range, no live stepper
let decorated = decorateItem(noodles, new Map());
assert.equal(decorated.isVeg, true, "veg variant should set isVeg");
assert.equal(decorated.isNonVeg, true, "non-veg variant should set isNonVeg");
assert.equal(decorated.priceLabel, "₹169–₹209", "price range should span variant prices");
assert.equal(decorated.hasQty, false, "variant items never show an inline stepper");
assert.equal(decorated.addLabel, "Choose", "variant items always say Choose");

// addToCart: variant lines are keyed separately, non-variant merges by id
let cart = addToCart([], noodles, noodles.variants![0], 2);
cart = addToCart(cart, noodles, noodles.variants![1], 1);
cart = addToCart(cart, soup, null, 1);
assert.equal(cart.length, 3, "three distinct lines: veg noodles, chicken noodles, soup");
assert.equal(cart.find((l) => l.key === lineKey("noodles", "Veg"))?.qty, 2);

// re-adding the same variant merges quantity rather than duplicating the line
cart = addToCart(cart, noodles, noodles.variants![0], 1);
assert.equal(cart.length, 3, "merge, not a new line");
assert.equal(cart.find((l) => l.key === lineKey("noodles", "Veg"))?.qty, 3);

// decorateItem sums qty across variants for the list-card badge
const qtyMap = new Map(cart.map((l) => [l.key, l.qty]));
decorated = decorateItem(noodles, qtyMap);
assert.equal(decorated.qty, 4, "3 veg + 1 chicken = 4 total noodles in cart");

// bumpCart removes a line once it hits 0
cart = bumpCart(cart, lineKey("veg-soup"), -1);
assert.equal(
  cart.find((l) => l.key === "veg-soup"),
  undefined,
  "qty 0 line should be removed",
);

// cartTotals: cost sums price*qty, prep is the mean, count sums qty
const totals = cartTotals(cart);
assert.equal(totals.cost, 169 * 3 + 209 * 1, "cost = sum(price * qty)");
assert.equal(totals.count, 4);
assert.equal(totals.prepMinutes, 16, "both remaining lines are noodles at 16 min");

// lineFromItem: name/variant stay separate (for the two-line cart row), Hindi
// labels are snapshotted from the menu at add-time (needed for order_items).
const line = lineFromItem(noodles, noodles.variants![1], 1);
assert.equal(line.name, "Noodles", "base name only, not combined with variant");
assert.equal(line.variantName, "Chicken");
assert.equal(line.nameHi, "नूडल्स");
assert.equal(line.variantNameHi, "चिकन");
assert.equal(lineLabel(line), "Noodles (Chicken)", "lineLabel combines them for single-string display");

console.log("cart.check.ts: all assertions passed");
