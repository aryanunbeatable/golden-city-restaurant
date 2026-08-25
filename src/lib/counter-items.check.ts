// Runnable self-check: node --experimental-strip-types src/lib/counter-items.check.ts
import assert from "node:assert/strict";
import { isCounterItemName, kitchenLines } from "./counter-items.ts";
import menu from "../data/menu.json" with { type: "json" };
import type { Menu } from "../types/menu.ts";

// The real menu is the fixture here on purpose: the whole point of this module
// is that it stays in step with menu.json, so a check against a hand-made menu
// would prove nothing.
const items = (menu as Menu).categories.flatMap((c) => c.items);
const flagged = items.filter((i) => i.counterItem);

assert.ok(flagged.length > 0, "menu.json should flag at least one counter item");
for (const i of flagged) {
  assert.ok(isCounterItemName(i.name), `${i.name} is flagged in menu.json and must match by name`);
  assert.equal(i.prepTimeMinutes, 0, `${i.name} is not cooked, so its prep time should be 0`);
}

// Real dishes must never be mistaken for counter items.
for (const i of items.filter((i) => !i.counterItem)) {
  assert.ok(!isCounterItemName(i.name), `${i.name} is a real dish and must reach the kitchen`);
}

// kitchenLines drops bottles and keeps food, preserving order.
const lines = [
  { item_name: "Veg Soup" },
  { item_name: "Water Bottle (500ml)" },
  { item_name: "Egg Biryani" },
];
assert.deepEqual(
  kitchenLines(lines).map((l) => l.item_name),
  ["Veg Soup", "Egg Biryani"],
  "bottles are removed, cooking order is preserved",
);
assert.equal(kitchenLines([{ item_name: "Water Bottle (1L)" }]).length, 0, "bottles-only leaves nothing to cook");
assert.equal(kitchenLines([]).length, 0);

console.log("counter-items.check.ts: all assertions passed");
