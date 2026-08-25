// Which order lines are "sold at the counter" rather than cooked — water
// bottles today. See MenuItem.counterItem for why the flag exists.
//
// order_items rows snapshot only the item NAME (no item id — see
// supabase/migrations/0001_orders.sql), so a placed order can only be matched
// back by name. The set is derived from menu.json rather than hard-coded, so
// adding another counter item is a one-line data change and nothing here
// needs touching.
//
// Renaming an existing counter item would leave already-placed orders
// unmatched. That is deliberate and harmless: the only consequence is an old
// order showing its bottle line on the kitchen board, and money/history are
// never affected because totals come from order_items regardless.
import menu from "../data/menu.json" with { type: "json" };
import type { Menu } from "../types/menu.ts";

const COUNTER_ITEM_NAMES: ReadonlySet<string> = new Set(
  (menu as Menu).categories.flatMap((c) => c.items.filter((i) => i.counterItem).map((i) => i.name)),
);

/** True for a line the kitchen never has to make. */
export function isCounterItemName(itemName: string): boolean {
  return COUNTER_ITEM_NAMES.has(itemName);
}

/** The lines the kitchen actually has to cook. */
export function kitchenLines<T extends { item_name: string }>(items: T[]): T[] {
  return items.filter((it) => !isCounterItemName(it.item_name));
}
