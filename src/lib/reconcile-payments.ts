// Recovers phone orders whose money arrived but whose confirmation never did.
//
// confirmPhonePayment() runs in the customer's browser after Razorpay Checkout
// returns. If that browser dies in between — tab closed, tunnel dropped, phone
// out of battery — Razorpay has the money and we have an order stuck in
// awaiting_payment, which is invisible to the manager, the kitchen, history and
// every total. The customer arrives expecting food nobody has cooked.
//
// ponytail: the real fix is the payment webhook, which needs a
// RAZORPAY_WEBHOOK_SECRET the account can't issue until it's activated. This
// asks Razorpay the same question at the one moment someone is there to act on
// the answer — opening the orders board. Delete it, or keep it as a backstop,
// once the webhook exists.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase/server";
import { fetchOrder, fetchOrderPayments, findOrderByReceipt, settleablePayment } from "@/lib/razorpay";

// Below this, the customer's own callback is probably still in flight and
// would race us. Both paths guard on status, so a race is safe rather than
// wrong — this just avoids the pointless API calls.
const STUCK_AFTER_MS = 10 * 60_000;
// Far enough back to cover a closed day and a half; past that, an unconfirmed
// order is not something a sweep should still be paying Razorpay to ask about.
const LOOK_BACK_MS = 3 * 24 * 60 * 60_000;
// Most stuck rows are abandoned checkouts that will never settle, and they'd
// otherwise be re-asked every load. Newest first: the recent one is the one
// most likely to be a real payment with a customer waiting behind it.
const MAX_PER_SWEEP = 10;

interface StuckOrder {
  id: string;
  razorpay_order_id: string | null;
  order_items: { quantity: number; unit_price: number }[] | null;
}

/**
 * Their order id for ours. Prefer the one we stored at checkout: fetching by id
 * is immediately consistent, whereas the filtered order list is not — measured
 * against the live API, a new order took about two minutes to appear in it.
 * The receipt lookup is the fallback for rows written before migration 0011.
 */
async function razorpayOrderFor(order: StuckOrder) {
  if (order.razorpay_order_id) {
    const found = await fetchOrder(order.razorpay_order_id);
    return found.receipt === order.id ? found : null;
  }
  return findOrderByReceipt(order.id);
}

async function settleOne(supabase: SupabaseClient, order: StuckOrder): Promise<boolean> {
  const expectedPaise = Math.round(
    (order.order_items ?? []).reduce((sum, i) => sum + i.quantity * i.unit_price, 0) * 100,
  );
  if (expectedPaise <= 0) return false;

  // The receipt binding is the whole basis for trusting that this payment was
  // for this order, so it is checked on both paths rather than assumed.
  const rzpOrder = await razorpayOrderFor(order);
  if (!rzpOrder || rzpOrder.receipt !== order.id) return false;

  const payment = settleablePayment(await fetchOrderPayments(rzpOrder.id), rzpOrder.id, expectedPaise);
  if (!payment) return false;

  const { error } = await supabase
    .from("orders")
    .update({
      status: "waiting_confirmation",
      payment_status: "paid",
      payment_method: "phone_online",
      payment_reference: payment.id,
    })
    .eq("id", order.id)
    .eq("status", "awaiting_payment"); // no-op if the customer's callback won

  if (error) throw new Error(error.message);
  return true;
}

/** Returns how many orders were recovered. Never throws — a sweep failing must
 *  not stop the manager from seeing the board. */
export async function reconcileStuckPayments(): Promise<number> {
  const now = Date.now();
  const supabase = getServiceSupabase();

  const { data: stuck, error } = await supabase
    .from("orders")
    .select("id, razorpay_order_id, order_items(quantity, unit_price)")
    .eq("source", "phone")
    .eq("status", "awaiting_payment")
    .lt("created_at", new Date(now - STUCK_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - LOOK_BACK_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_PER_SWEEP);

  if (error) {
    // Most likely cause: migration 0011 hasn't been applied. Silence here would
    // mean the sweep quietly does nothing while money sits unclaimed.
    console.error("[reconcile] couldn't read stuck orders:", error.message);
    return 0;
  }
  if (!stuck?.length) return 0;

  const settled = await Promise.all(
    (stuck as StuckOrder[]).map((o) =>
      settleOne(supabase, o).catch((e) => {
        console.error(`[reconcile] order ${o.id}:`, e instanceof Error ? e.message : e);
        return false;
      }),
    ),
  );

  const recovered = settled.filter(Boolean).length;
  if (recovered) console.warn(`[reconcile] recovered ${recovered} paid order(s) the browser never confirmed`);
  return recovered;
}
