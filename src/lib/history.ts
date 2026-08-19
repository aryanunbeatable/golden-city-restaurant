import { getSupabase } from "@/lib/supabase/client";
import type { DayStat } from "@/lib/history-report";
import type { OrderItemRow, OrderWithItems } from "@/types/order";

/** Per-day count/revenue for the calendar cells, via the order_day_stats RPC
 *  (supabase/migrations/0004_day_stats.sql) — a month of numbers instead of a
 *  month of orders. */
export async function fetchDayStats(startMs: number, endMs: number): Promise<Map<string, DayStat>> {
  const { data, error } = await getSupabase().rpc("order_day_stats", {
    p_start: new Date(startMs).toISOString(),
    p_end: new Date(endMs).toISOString(),
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { day_key: string; order_count: number; revenue: number }[];
  return new Map(rows.map((r) => [r.day_key, { count: Number(r.order_count), revenue: Number(r.revenue) }]));
}

export async function fetchOrdersInRange(startMs: number, endMs: number): Promise<OrderWithItems[]> {
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*, order_items(*)")
    .gte("created_at", new Date(startMs).toISOString())
    .lt("created_at", new Date(endMs).toISOString())
    // An abandoned phone checkout is not an order — it must never appear in
    // history or move a total.
    .neq("status", "awaiting_payment")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderWithItems[];
}

/** Orders containing a dish whose name matches `query`. Scoped to a range
 *  unless `range` is null (the "all time" toggle) — an unbounded scan across
 *  years of orders is the query that gets slow first. */
export async function searchByDish(
  query: string,
  range: { startMs: number; endMs: number } | null,
): Promise<OrderWithItems[]> {
  let q = getSupabase()
    .from("orders")
    .select("*, order_items!inner(*)")
    .ilike("order_items.item_name", `%${query}%`)
    .neq("status", "awaiting_payment")
    .order("created_at", { ascending: false })
    .limit(500);
  if (range) {
    q = q
      .gte("created_at", new Date(range.startMs).toISOString())
      .lt("created_at", new Date(range.endMs).toISOString());
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // !inner prunes order_items down to just the matching lines, which is right
  // for the "sold N times" headline but wrong for showing the order — refetch
  // the full item lists for the orders that matched.
  const orders = (data ?? []) as OrderWithItems[];
  if (orders.length === 0) return [];
  const { data: items, error: itemsError } = await getSupabase()
    .from("order_items")
    .select("*")
    .in(
      "order_id",
      orders.map((o) => o.id),
    );
  if (itemsError) throw new Error(itemsError.message);

  const byOrder = new Map<string, OrderItemRow[]>();
  for (const it of (items ?? []) as OrderItemRow[]) {
    const list = byOrder.get(it.order_id) ?? [];
    list.push(it);
    byOrder.set(it.order_id, list);
  }
  return orders.map((o) => ({ ...o, order_items: byOrder.get(o.id) ?? o.order_items }));
}

export function downloadCsv(filename: string, csv: string): void {
  // A BOM so Excel opens the rupee amounts and any Devanagari as UTF-8.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
