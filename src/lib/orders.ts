import { getSupabase } from "@/lib/supabase/client";
import type { CartLine } from "@/lib/cart";
import type { PaymentMethod, PaymentStatus } from "@/types/order";

export interface PlaceOrderInput {
  source: string; // 'table_1' | ... | 'swiggy' | 'zomato' | 'parcel'
  placedBy: "customer" | "manager";
  prepMinutes: number;
  lines: CartLine[];
  /** Null when the guest hasn't settled yet — recorded later at the counter. */
  paymentMethod?: PaymentMethod | null;
  paymentStatus?: PaymentStatus;
}

// Wraps the create_order() RPC (supabase/migrations/0001_orders.sql) — it
// writes the order and its items in one transaction, so the kitchen board's
// realtime INSERT event never arrives before the items exist to fetch.
export async function placeOrder({
  source,
  placedBy,
  prepMinutes,
  lines,
  paymentMethod = null,
  paymentStatus = "pending",
}: PlaceOrderInput): Promise<string> {
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
    p_payment_method: paymentMethod,
    p_payment_status: paymentStatus,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

// Cancelling keeps the row (history must stay honest) but drops it out of the
// kitchen board's columns and out of every revenue total.
export async function cancelOrder(id: string): Promise<void> {
  const { error } = await getSupabase().from("orders").update({ status: "cancelled" }).eq("id", id);
  if (error) throw new Error(error.message);
}

// Settling a counter payment: the method isn't edited, it's recorded for the
// first time when the guest actually pays.
export async function settlePayment(id: string, method: PaymentMethod): Promise<void> {
  const { error } = await getSupabase()
    .from("orders")
    .update({ payment_method: method, payment_status: "paid" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// "3s ago" / "4m 12s ago" — shared by the customer tracking screen and the
// manager orders list so both age columns read identically.
export function since(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}
