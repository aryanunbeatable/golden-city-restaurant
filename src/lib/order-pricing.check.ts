// Runnable self-check: node --experimental-strip-types src/lib/order-pricing.check.ts
import assert from "node:assert/strict";
import { priceCart } from "./order-pricing.ts";
import type { Menu } from "../types/menu.ts";

const menu: Menu = {
  restaurant: "Golden City Restaurant",
  location: "Gorakhpur",
  tableCount: 4,
  categories: [
    {
      id: "soups",
      name: "Soups",
      items: [
        {
          id: "veg-soup",
          name: "Veg Soup",
          description: "",
          price: 119,
          veg: true,
          prepTimeMinutes: 10,
          photo: "placeholder",
          nameHi: "वेज सूप",
        },
        {
          id: "manchow",
          name: "Manchow Soup",
          description: "",
          variants: [
            { name: "Veg", price: 139, veg: true, nameHi: "वेज" },
            { name: "Non-Veg", price: 149, veg: false, nameHi: "नॉन-वेज" },
          ],
          prepTimeMinutes: 12,
          photo: "placeholder",
          nameHi: "मंचाउ सूप",
        },
      ],
    },
  ],
};

const ok = (r: ReturnType<typeof priceCart>) => {
  assert.ok("cart" in r, "error" in r ? `unexpected rejection: ${r.error}` : "expected a cart");
  return r.cart;
};
const err = (r: ReturnType<typeof priceCart>) => {
  assert.ok("error" in r, "expected a rejection");
  return r.error;
};

// --- happy path: prices come from the menu, not the request ---
let cart = ok(
  priceCart(menu, [
    { itemId: "veg-soup", variantName: null, qty: 2 },
    { itemId: "manchow", variantName: "Non-Veg", qty: 1 },
  ]),
);
assert.equal(cart.total, 119 * 2 + 149);
assert.equal(cart.totalPaise, 38700, "Razorpay wants paise");
assert.equal(cart.lines[0].unit_price, 119);
assert.equal(cart.lines[1].variant_name, "Non-Veg");
assert.equal(cart.lines[1].is_veg, false, "veg flag follows the chosen variant");
assert.equal(cart.lines[1].variant_name_hi, "नॉन-वेज", "Hindi snapshotted for the kitchen toggle");
assert.equal(cart.prepMinutes, 11, "mean prep across distinct lines");
assert.equal(cart.prepMinutesMax, 12, "slowest dish, for scheduled cook-start");

// A scheduled order must cook backwards from its slowest dish, never the mean —
// otherwise a fast drink alongside a slow curry starts far too late.
const mixed = ok(
  priceCart(menu, [
    { itemId: "veg-soup", variantName: null, qty: 1 }, // 10 min
    { itemId: "manchow", variantName: "Veg", qty: 1 }, // 12 min
  ]),
);
assert.equal(mixed.prepMinutes, 11, "mean sits between the two");
assert.equal(mixed.prepMinutesMax, 12, "max is the slowest dish");
assert.ok(mixed.prepMinutesMax >= mixed.prepMinutes, "max can never be under the mean");

// A single item still prices correctly.
cart = ok(priceCart(menu, [{ itemId: "veg-soup", variantName: null, qty: 1 }]));
assert.equal(cart.totalPaise, 11900);

// --- rejections: this is the trust boundary ---
assert.match(err(priceCart(menu, [])), /empty/i);
assert.match(
  err(priceCart(menu, [{ itemId: "not-a-dish", variantName: null, qty: 1 }])),
  /no longer on the menu/i,
  "unknown item id must be refused, not priced at 0",
);
assert.match(
  err(priceCart(menu, [{ itemId: "manchow", variantName: null, qty: 1 }])),
  /Pick an option/i,
  "a variant item needs a variant",
);
assert.match(
  err(priceCart(menu, [{ itemId: "manchow", variantName: "Free", qty: 1 }])),
  /Pick an option/i,
  "an invented variant name must not be accepted",
);
assert.match(
  err(priceCart(menu, [{ itemId: "veg-soup", variantName: "Large", qty: 1 }])),
  /doesn't have options/i,
);

// Quantities
for (const qty of [0, -1, 1.5, 51, NaN]) {
  assert.match(
    err(priceCart(menu, [{ itemId: "veg-soup", variantName: null, qty }])),
    /quantities isn't valid/i,
    `qty ${qty} must be refused`,
  );
}

// Duplicate lines can't be used to slip past the per-line quantity cap.
assert.match(
  err(
    priceCart(menu, [
      { itemId: "veg-soup", variantName: null, qty: 50 },
      { itemId: "veg-soup", variantName: null, qty: 50 },
    ]),
  ),
  /duplicated/i,
);

// The same item under two different variants is legitimate, not a duplicate.
cart = ok(
  priceCart(menu, [
    { itemId: "manchow", variantName: "Veg", qty: 1 },
    { itemId: "manchow", variantName: "Non-Veg", qty: 1 },
  ]),
);
assert.equal(cart.total, 139 + 149);

// Too many distinct dishes.
assert.match(
  err(priceCart(menu, Array.from({ length: 41 }, () => ({ itemId: "veg-soup", variantName: null, qty: 1 })))),
  /too many/i,
);

console.log("order-pricing.check.ts: all assertions passed");
