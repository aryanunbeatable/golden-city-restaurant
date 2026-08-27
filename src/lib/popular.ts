// Turning raw order counts into the handful of tiles the menu actually shows.
//
// Pure (no Supabase, no React) so it stays runnable under
// `node --experimental-strip-types`; see popular.check.ts. Relative imports
// with extensions exist for that reason.
//
// The join back to the menu is BY NAME, and that is a real constraint rather
// than a shortcut: order_items snapshots item_name as text with no item id
// (supabase/migrations/0001_orders.sql), so history has no other handle on the
// dish. Renaming an item in menu.json therefore resets its ranking to zero.
// Rows that match nothing are dropped — there is no item left to render.
import { isCounterItemName } from "./counter-items.ts";
import type { Menu, MenuItem, MenuVariant } from "../types/menu.ts";

/** Rolling window the ranking is measured over. Short enough that the menu's
 *  Seasonal items rotate out on their own. */
export const WINDOW_DAYS = 30;

/** The gate: this many distinct dishes must each have been ordered at least
 *  GATE_MIN_ORDERS times before anything is shown at all.
 *
 *  Measured over ALL TIME, not the window — that is what makes the gate a
 *  latch. At ~30 orders a day this opens within the first week; if it is still
 *  closed after a fortnight of real trade, lower GATE_MIN_ORDERS rather than
 *  guessing at the cause. */
export const GATE_MIN_ITEMS = 10;
export const GATE_MIN_ORDERS = 3;

/** Tiles shown once the gate is open. */
export const MAX_TILES = 10;

/** One row of public.popular_items(). */
export interface PopularRow {
  item_name: string;
  variant_name: string | null;
  order_count: number;
}

/** A dish to render, with the exact variant that earned its place — so the
 *  tile adds in one tap instead of opening the variant chooser. */
export interface PopularEntry {
  item: MenuItem;
  variant: MenuVariant | null;
  orderCount: number;
}

function allItems(menu: Menu): MenuItem[] {
  return menu.categories.flatMap((c) => c.items);
}

/** Resolve one history row against the current menu. Null when the dish has
 *  been renamed or removed, or when it is a counter item (water) — those ride
 *  along on nearly every bill and would hold the top slots permanently while
 *  being one tap away on the billing screen anyway. */
function resolve(items: MenuItem[], row: PopularRow): PopularEntry | null {
  if (isCounterItemName(row.item_name)) return null;
  const item = items.find((i) => i.name === row.item_name);
  if (!item) return null;
  const variant = row.variant_name ? (item.variants?.find((v) => v.name === row.variant_name) ?? null) : null;
  // A row naming a variant the menu no longer has is as stale as a renamed
  // dish — its price may have moved, so it must not be rendered.
  if (row.variant_name && !variant) return null;
  return { item, variant, orderCount: row.order_count };
}

/**
 * Is there enough history for a "most ordered" claim to mean anything?
 *
 * Counts a dish's orders across ALL its variants: a dish split 2/2 between
 * Half and Full has been ordered four times, and pretending otherwise would
 * hold the gate shut on a technicality.
 */
export function gateOpen(menu: Menu, allTimeRows: PopularRow[]): boolean {
  const items = allItems(menu);
  const byItem = new Map<string, number>();
  for (const row of allTimeRows) {
    const hit = resolve(items, row);
    if (!hit) continue;
    byItem.set(hit.item.id, (byItem.get(hit.item.id) ?? 0) + row.order_count);
  }
  let qualifying = 0;
  for (const count of byItem.values()) if (count >= GATE_MIN_ORDERS) qualifying++;
  return qualifying >= GATE_MIN_ITEMS;
}

/**
 * The window's ranking, capped at one entry per dish.
 *
 * Ranking happens per variant so the tile can add without a chooser, but a
 * single popular dish must not spend two of ten slots on its own Half and
 * Full — so only its best-selling variant survives.
 */
export function rankPopular(menu: Menu, windowRows: PopularRow[]): PopularEntry[] {
  const items = allItems(menu);
  const ranked = [...windowRows].sort(
    (a, b) => b.order_count - a.order_count || a.item_name.localeCompare(b.item_name),
  );
  const seen = new Set<string>();
  const out: PopularEntry[] = [];
  for (const row of ranked) {
    const hit = resolve(items, row);
    if (!hit || seen.has(hit.item.id)) continue;
    seen.add(hit.item.id);
    out.push(hit);
    if (out.length === MAX_TILES) break;
  }
  return out;
}

/** What the menu renders: the ranking if the gate is open, nothing before. */
export function popularEntries(
  menu: Menu,
  windowRows: PopularRow[],
  allTimeRows: PopularRow[],
): PopularEntry[] {
  if (!gateOpen(menu, allTimeRows)) return [];
  return rankPopular(menu, windowRows);
}

/** How far back the ranking window reaches from `now`. */
export function windowStart(now: number): Date {
  return new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000);
}
