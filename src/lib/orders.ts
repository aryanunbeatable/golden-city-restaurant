import { getSupabase } from "@/lib/supabase/client";
import type { CartLine } from "@/lib/cart";

export interface PlaceOrderInput {
  source: string; // 'table_1' | ... | 'swiggy' | 'zomato' | 'parcel'
  placedBy: "customer" | "manager";
  prepMinutes: number;
  lines: CartLine[];
}

// Wraps the create_order() RPC (supabase/migrations/0001_orders.sql) — it
// writes the order and its items in one transaction, so the kitchen board's
// realtime INSERT event never arrives before the items exist to fetch.
export async function placeOrder({ source, placedBy, prepMinutes, lines }: PlaceOrderInput): Promise<string> {
  const items = lines.map((l) => ({
    item_name: l.name,
    item_name_hi: l.nameHi,
    variant_name: l.variantName,
    variant_name_hi: l.variantNameHi,
    quantity: l.qty,
    unit_price: l.price,
    is_veg: l.veg,
  }));

  const { data, error } = await getSupabase().rpc("create_order", {
    p_source: source,
    p_placed_by: placedBy,
    p_prep_minutes: prepMinutes,
    p_items: items,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

// "3s ago" / "4m 12s ago" — shared by the customer tracking screen and the
// manager orders list so both age columns read identically.
export function since(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}
