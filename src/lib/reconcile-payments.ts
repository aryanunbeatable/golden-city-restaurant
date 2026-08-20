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
import { getServiceSupabase } from "./supabase/server.ts";
// Relative, with extensions: this module is loaded directly by
// reconcile-payments.check.ts under bare Node, which cannot resolve "@/".
import { fetchOrder, fetchOrderPayments, findOrderByReceipt, settleablePayment } from "./razorpay.ts";

// Below this, the customer's own callback is probably still in flight and
// would race us. Both paths guard on status, so a race is safe rather than
// wrong — this just avoids the pointless API calls.
export const STUCK_AFTER_MS = 10 * 60_000;
// How long an unsettled order stays a candidate. Money arrives at Razorpay
// within a minute or two of checkout, so anything unpaid six hours later was
// abandoned, not lost. Long enough to cover a whole service session in case
// the cron itself was down for part of it.
export const GIVE_UP_AFTER_MS = 6 * 60 * 60_000;
// Don't ask Razorpay about the same order more often than this. Without it, a
// per-minute cron re-asks every abandoned checkout every 60 seconds for as
// long as it stays a candidate.
export const RECHECK_AFTER_MS = 15 * 60_000;
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

  const staleEnough = new Date(now - RECHECK_AFTER_MS).toISOString();
  const { data: stuck, error } = await supabase
    .from("orders")
    .select("id, razorpay_order_id, order_items(quantity, unit_price)")
    .eq("source", "phone")
    .eq("status", "awaiting_payment")
    .lt("created_at", new Date(now - STUCK_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - GIVE_UP_AFTER_MS).toISOString())
    // Never asked, or not asked recently.
    .or(`reconcile_checked_at.is.null,reconcile_checked_at.lt.${staleEnough}`)
    // Least-recently-checked first, never-checked ahead of everything. This is
    // what stops starvation: with created_at DESC, a paid order could be pushed
    // past MAX_PER_SWEEP by newer abandoned checkouts and never looked at
    // again. Round-robin guarantees every candidate comes up.
    .order("reconcile_checked_at", { ascending: true, nullsFirst: true })
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

  // Record the attempt on everything that did not settle — including the ones
  // that threw, because a Razorpay outage retried every 60 seconds is the same
  // hammering this exists to avoid. Settled orders leave the pool anyway.
  const unsettled = (stuck as StuckOrder[]).filter((_, i) => !settled[i]).map((o) => o.id);
  if (unsettled.length) {
    const { error: stampError } = await supabase
      .from("orders")
      .update({ reconcile_checked_at: new Date().toISOString() })
      .in("id", unsettled);
    // Losing the stamp only costs a repeat check next minute, never money.
    if (stampError) console.error("[reconcile] couldn't stamp checked orders:", stampError.message);
  }

  const recovered = settled.filter(Boolean).length;
  if (recovered) console.warn(`[reconcile] recovered ${recovered} paid order(s) the browser never confirmed`);
  return recovered;
}
