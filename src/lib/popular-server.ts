import { getSupabase } from "@/lib/supabase/client";
import menuJson from "@/data/menu.json";
import {
  leastOrderedCategoryId,
  popularEntries,
  windowStart,
  type PopularEntry,
  type PopularRow,
} from "@/lib/popular";
import type { Menu } from "@/types/menu";

// Six hours. A 30-day rolling ranking barely moves between one lunch service
// and the next, so staleness here is invisible — while an uncached read would
// re-run the aggregation on every QR scan of every table, all evening.
const TTL_MS = 6 * 60 * 60 * 1000;

// ponytail: plain in-memory memo, not Next's cache. `use cache` needs
// cacheComponents enabled app-wide, which changes rendering semantics for every
// route in a live ordering app — far too much blast radius for one query — and
// unstable_cache is legacy as of Next 16. The ceiling: this cache is per server
// instance, so a cold start re-queries. That costs one cheap GROUP BY, which is
// the right trade until traffic makes it not. Upgrade path is `use cache` if
// Cache Components is ever turned on for other reasons.
interface Cached {
  at: number;
  entries: PopularEntry[];
  // null when the gate is shut — same threshold as "Popular" itself, so this
  // never demotes a category chip on thin/fabricated-looking data.
  leastOrderedCategoryId: string | null;
}
let cache: Cached | null = null;

/**
 * Fetches and ranks once per TTL window; both getPopularEntries() and
 * getLeastOrderedCategoryId() share this single Supabase round trip.
 *
 * Never throws. A menu that fails to render because a ranking query failed
 * would be a far worse outage than a menu with no "Popular" section, so every
 * failure degrades to empty/null. It is logged loudly rather than swallowed:
 * the most likely cause is migration 0014 never having been applied, which is
 * exactly the failure that once left the reconcile sweep silently returning
 * zero for weeks.
 */
async function ensureCache(): Promise<Cached> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache;

  try {
    const supabase = getSupabase();
    const [windowRes, allTimeRes] = await Promise.all([
      supabase.rpc("popular_items", { p_since: windowStart(now).toISOString() }),
      supabase.rpc("popular_items", { p_since: null }),
    ]);
    const failure = windowRes.error ?? allTimeRes.error;
    if (failure) throw new Error(failure.message);

    const menu = menuJson as Menu;
    const windowRows = (windowRes.data ?? []) as PopularRow[];
    const entries = popularEntries(menu, windowRows, (allTimeRes.data ?? []) as PopularRow[]);
    cache = {
      at: now,
      entries,
      leastOrderedCategoryId: entries.length > 0 ? leastOrderedCategoryId(menu, windowRows) : null,
    };
    return cache;
  } catch (e) {
    console.error(
      "[popular] ranking unavailable — the menu will render without it. " +
        "If this persists, check that supabase/migrations/0014_popular_items.sql has been applied:",
      e instanceof Error ? e.message : e,
    );
    // Keep serving the last good ranking if we ever had one.
    return cache ?? { at: now, entries: [], leastOrderedCategoryId: null };
  }
}

/** The dishes to surface, already gated and ranked. Empty until there is
 *  enough history to justify the claim — see popular.ts. */
export async function getPopularEntries(): Promise<PopularEntry[]> {
  return (await ensureCache()).entries;
}

/** The category chip to fold into "Popular" instead of adding a new one
 *  alongside it. Null whenever getPopularEntries() would also be empty. */
export async function getLeastOrderedCategoryId(): Promise<string | null> {
  return (await ensureCache()).leastOrderedCategoryId;
}
