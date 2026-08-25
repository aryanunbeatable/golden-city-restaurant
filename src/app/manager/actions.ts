"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import {
  MANAGER_SESSION_COOKIE,
  MANAGER_SESSION_TTL_MS,
  createSessionCookieValue,
  isValidSessionCookieValue,
} from "@/lib/manager-session";
import { getServiceSupabase } from "@/lib/supabase/server";
import { sendOrderPush } from "@/lib/push";
import { refundPayment } from "@/lib/razorpay";
import { clockLabel, isValidPickupTime } from "@/lib/service-hours";
import { businessDayCutoffMs } from "@/lib/business-day";
import { COUNTER_ITEMS, isCounterItemName } from "@/lib/counter-items";
import {
  isTableSource,
  type OrderItemRow,
  type OrderSource,
  type PaymentMethod,
} from "@/types/order";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// A server action is a public endpoint — being rendered behind the PIN gate
// proves nothing about who is calling it. Every privileged action re-checks
// the session itself rather than trusting the proxy.
async function isManager(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionCookieValue(store.get(MANAGER_SESSION_COOKIE)?.value);
}

export async function verifyManagerPin(pin: string): Promise<{ ok: boolean }> {
  const expected = process.env.MANAGER_PIN;
  const value = expected ? createSessionCookieValue() : null;
  // Missing env config fails closed (nobody gets in) rather than open.
  if (!expected || !value || pin !== expected) return { ok: false };

  const store = await cookies();
  store.set(MANAGER_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MANAGER_SESSION_TTL_MS / 1000,
    path: "/manager",
  });
  return { ok: true };
}

export async function signOutManager(): Promise<void> {
  const store = await cookies();
  store.delete({ name: MANAGER_SESSION_COOKIE, path: "/manager" });
}

// Only the two methods the counter can actually take. Without this the action
// would happily record an order as settled through Razorpay.
const SETTLEABLE: PaymentMethod[] = ["counter_cash", "counter_online"];

/**
 * Record a counter payment. Runs with the service-role key because the public
 * anon key is deliberately barred from writing payment columns
 * (supabase/migrations/0007_lock_anon_out_of_payments.sql) — otherwise anyone
 * with the public key could mark their own order paid.
 */
export async function settleOrderPayment(
  orderId: string,
  method: PaymentMethod,
): Promise<ActionResult> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };
  if (!SETTLEABLE.includes(method))
    return { ok: false, error: "Unsupported payment method." };

  // Only an unpaid order can be settled. Guarding in the WHERE clause rather
  // than with a read-then-write closes the race, and stops a stale page from
  // rewriting an order already paid through Razorpay as counter cash — which
  // would report online revenue as cash and leave payment_reference pointing
  // at a payment that no longer matches the recorded method.
  const { data, error } = await getServiceSupabase()
    .from("orders")
    .update({ payment_method: method, payment_status: "paid" })
    .eq("id", orderId)
    .eq("payment_status", "pending")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "That order is already settled — reload the page.",
    };
  }
  return { ok: true };
}

/**
 * Settle a whole table at once — every unpaid order on it, one payment.
 *
 * The table is named, not the order ids. A server action is a public endpoint,
 * so accepting a list of ids from the browser would mean trusting whatever it
 * sent; deriving the set here means the worst a forged call can do is settle
 * the table it names, which is the only thing this action is for anyway.
 *
 * Scoped to the current business day for the same reason the boards are: an
 * order forgotten last week must not attach itself to tonight's table. Those
 * stay settleable from History.
 */
export async function settleTableBill(
  source: OrderSource,
  method: PaymentMethod,
): Promise<ActionResult & { settled?: number; total?: number }> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };
  if (!SETTLEABLE.includes(method))
    return { ok: false, error: "Unsupported payment method." };
  if (!isTableSource(source))
    return { ok: false, error: "That isn't a table." };

  const cutoff = new Date(businessDayCutoffMs(Date.now())).toISOString();
  const { data, error } = await getServiceSupabase()
    .from("orders")
    .update({ payment_method: method, payment_status: "paid" })
    .eq("source", source)
    .gte("created_at", cutoff)
    // Same WHERE-clause guards as settleOrderPayment: only pending money is
    // taken, and a voided or abandoned order is never charged for. Guarding
    // here rather than with a read-then-write closes the race where a second
    // terminal settles the same table in between.
    .eq("payment_status", "pending")
    .not("status", "in", "(cancelled,awaiting_payment)")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Nothing left to collect on that table — reload the page.",
    };
  }
  return { ok: true, settled: data.length };
}

/**
 * Add a counter item (water bottles) to an unpaid order at billing time.
 *
 * Price comes from menu.json, never from the browser — the same rule
 * priceCart() follows, and for the same reason: a hand-crafted request must
 * not be able to bill a bottle at ₹0 or ₹0.01. The item must additionally be
 * flagged `counterItem`, so this endpoint can only ever add bottles, never
 * quietly append a biryani to somebody's bill.
 */
export async function addCounterItem(
  orderId: string,
  itemId: string,
  qty: number,
): Promise<ActionResult & { item?: OrderItemRow }> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };
  if (!Number.isInteger(qty) || qty < 1 || qty > 20)
    return { ok: false, error: "Pick between 1 and 20." };

  const item = COUNTER_ITEMS.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "That isn't a counter item." };
  if (typeof item.price !== "number")
    return { ok: false, error: "That item has no price." };

  const supabase = getServiceSupabase();
  // Only an unpaid, live order may grow. Adding to a settled bill would
  // create money owed against an order already recorded as paid, which
  // nothing downstream would ever surface again.
  const { data: target, error: readError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("payment_status", "pending")
    .not("status", "in", "(cancelled,awaiting_payment)")
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!target)
    return {
      ok: false,
      error: "That order is already settled — reload the page.",
    };

  // The inserted row is returned so the caller can patch its local order
  // state directly — nothing here subscribes to order_items over realtime,
  // only to the orders table, so without this the bottle would go on the
  // bill in the database but not visibly on screen until a reload.
  const { data: inserted, error } = await supabase
    .from("order_items")
    .insert({
      order_id: orderId,
      item_name: item.name,
      item_name_hi: item.nameHi,
      variant_name: null,
      variant_name_hi: null,
      quantity: qty,
      unit_price: item.price,
      is_veg: item.veg ?? true,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, item: inserted as OrderItemRow };
}

/**
 * Undo one addCounterItem() call — deletes the whole order_items row.
 *
 * Each "Add" click creates its own row rather than merging into an existing
 * one, so a row here is exactly one prior Add, and removing it is exactly
 * undoing that Add — no partial-quantity math to get wrong. Scoped to
 * counter items only, the same as addCounterItem: this must never become a
 * way to delete a dish line the kitchen may already be cooking.
 */
export async function removeCounterItem(
  orderId: string,
  itemRowId: string,
): Promise<ActionResult> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };

  const supabase = getServiceSupabase();
  // Same guard as addCounterItem: only an unpaid, live order may be edited.
  const { data: target, error: readError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("payment_status", "pending")
    .not("status", "in", "(cancelled,awaiting_payment)")
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!target)
    return {
      ok: false,
      error: "That order is already settled — reload the page.",
    };

  const { data: row, error: rowError } = await supabase
    .from("order_items")
    .select("id, item_name")
    .eq("id", itemRowId)
    .eq("order_id", orderId)
    .maybeSingle();

  if (rowError) return { ok: false, error: rowError.message };
  if (!row || !isCounterItemName(row.item_name))
    return { ok: false, error: "That isn't a counter item." };

  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("id", itemRowId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Void an order. Kept, never deleted, and excluded from every total. */
export async function voidOrder(orderId: string): Promise<ActionResult> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };

  const { data, error } = await getServiceSupabase()
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  // A silent no-op would have the UI cheerfully show the order as voided.
  if (!data || data.length === 0)
    return { ok: false, error: "That order no longer exists." };
  return { ok: true };
}

// ---------- phone orders ----------

/**
 * Customer numbers live in order_contacts, which has RLS on and no policies —
 * the browser's anon key cannot read them (migration 0009). The approval queue
 * fetches them through here instead, behind the manager session.
 */
export async function getOrderPhones(
  orderIds: string[],
): Promise<Record<string, string>> {
  if (!(await isManager()) || orderIds.length === 0) return {};

  const { data, error } = await getServiceSupabase()
    .from("order_contacts")
    .select("order_id, phone")
    .in("order_id", orderIds);

  if (error || !data) return {};
  return Object.fromEntries(
    (data as { order_id: string; phone: string }[]).map((r) => [
      r.order_id,
      r.phone,
    ]),
  );
}

/**
 * Accept a paid phone order so the kitchen can see it. `readyBy` lets the
 * counter push the promised time out when the kitchen is slammed; it is
 * re-validated here because the client could post anything.
 */
export async function approvePhoneOrder(
  orderId: string,
  readyBy?: number,
): Promise<ActionResult> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };

  const patch: Record<string, unknown> = { status: "confirmed" };
  if (readyBy !== undefined) {
    if (!isValidPickupTime(Date.now(), readyBy)) {
      return { ok: false, error: "That ready-by time isn't available." };
    }
    patch.scheduled_for = new Date(readyBy).toISOString();
  }

  const { data, error } = await getServiceSupabase()
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    // Only a paid, unapproved order can be approved — never re-approve one the
    // kitchen has already started, and never approve one that isn't paid for.
    .eq("status", "waiting_confirmation")
    .eq("payment_status", "paid")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0)
    return {
      ok: false,
      error: "That order isn't waiting for approval any more.",
    };
  return { ok: true };
}

/**
 * Turn a paid phone order away and refund it. The cancel and the refund are
 * deliberately separate: if Razorpay refuses, the order is still cancelled and
 * the failure is reported, because silently leaving it live would send food the
 * kitchen was told not to make — and silently swallowing the error would leave
 * a customer out of pocket with nobody aware.
 */
export async function rejectPhoneOrder(orderId: string): Promise<ActionResult> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };

  const supabase = getServiceSupabase();
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, status, payment_status, payment_reference, refunded_at")
    .eq("id", orderId)
    .single();

  if (readError || !order)
    return { ok: false, error: "We couldn't find that order." };

  const { error: cancelError } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId);
  if (cancelError) return { ok: false, error: cancelError.message };

  const reference = order.payment_reference as string | null;
  const refundDue =
    order.payment_status === "paid" && !!reference && !order.refunded_at;

  // Cancelled for certain by this point, and told even if the refund below
  // fails — the thing the customer must not do is turn up for food that isn't
  // coming, which matters more than whether the money is back yet. The wording
  // has to match reality though: promising a refund on an order that was never
  // charged sends them chasing money nobody took.
  after(async () => {
    await sendOrderPush(orderId, {
      title: "Order cancelled",
      body: refundDue
        ? "Sorry — we couldn't take this one. Your payment is being refunded."
        : order.refunded_at
          ? "Sorry — we couldn't take this one. Your refund is already on its way."
          : order.payment_status === "paid"
            ? // Charged, but with no reference we cannot refund automatically.
              // Never tell someone who paid that they weren't charged.
              "Sorry — we couldn't take this one. We'll sort your refund out and call you."
            : "Sorry — we couldn't take this one. You haven't been charged.",
    });
  });

  if (!refundDue) {
    return { ok: true }; // nothing was taken, or it was already sent back
  }

  try {
    await refundPayment(reference);
    await supabase
      .from("orders")
      .update({ refunded_at: new Date().toISOString() })
      .eq("id", orderId);
    return { ok: true };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Order cancelled, but the refund failed: ${why}. Refund it from the Razorpay dashboard.`,
    };
  }
}

/**
 * "We're running behind." Moves the promised time and tells the customer.
 *
 * Moving scheduled_for rather than only messaging is the point: the kitchen
 * board derives cook-start from it, so a message-only version would leave the
 * pass working to a time nobody is cooking to any more. The customer's two
 * countdowns re-derive from it for free.
 */
export async function delayOrder(
  orderId: string,
  extraMinutes: number,
): Promise<ActionResult> {
  if (!(await isManager()))
    return {
      ok: false,
      error: "Session expired — unlock the dashboard again.",
    };
  if (
    !Number.isInteger(extraMinutes) ||
    extraMinutes < 5 ||
    extraMinutes > 60
  ) {
    return { ok: false, error: "Pick a delay between 5 and 60 minutes." };
  }

  const supabase = getServiceSupabase();
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, source, status, scheduled_for")
    .eq("id", orderId)
    .single();

  if (readError || !order?.scheduled_for)
    return { ok: false, error: "That order has no scheduled time." };

  const moved = new Date(
    new Date(order.scheduled_for).getTime() + extraMinutes * 60_000,
  );
  const { data: updated, error } = await supabase
    .from("orders")
    // Clearing the nudge lets the sweep fire again against the new time —
    // otherwise a customer nudged before the delay never hears about the
    // change and arrives on the old schedule.
    .update({ scheduled_for: moved.toISOString(), leave_notified_at: null })
    .eq("id", orderId)
    .eq("source", "phone")
    // The same conditions as canDelay in OrderActions, enforced here because a
    // server action is a public endpoint. In the WHERE clause rather than an
    // early return so that a cancellation landing between the read above and
    // this write wins: otherwise a refunded customer gets told their order is
    // running late, and the cleared nudge queues a second push after that.
    .in("status", ["confirmed", "preparing"])
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!updated)
    return {
      ok: false,
      error: "That order isn't running — refresh the board.",
    };

  after(async () => {
    await sendOrderPush(orderId, {
      title: "Running a little late",
      body: `Sorry — your order will now be ready by ${clockLabel(moved.getTime())}.`,
      tag: `${orderId}:late`,
    });
  });

  return { ok: true };
}
