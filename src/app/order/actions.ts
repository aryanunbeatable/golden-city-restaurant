"use server";

import { headers } from "next/headers";
import menuData from "@/data/menu.json";
import type { Menu } from "@/types/menu";
import { getServiceSupabase } from "@/lib/supabase/server";
import { priceCart, type RequestedLine } from "@/lib/order-pricing";
import { isAcceptingOrders, isValidPickupTime } from "@/lib/service-hours";
import { normalizeName, normalizePhone } from "@/lib/phone";
import { checkRateLimit, clientIp, recordRateLimitEvent } from "@/lib/rate-limit";
import { createRazorpayOrder, verifyPaymentForOrder } from "@/lib/razorpay";
import type { OrderServiceType } from "@/types/order";

const menu = menuData as Menu;

// /order is public and unauthenticated, and every accepted call writes rows and
// creates a Razorpay order. Generous enough that a real customer redoing their
// order never notices, tight enough that a script cannot fill the table.
const PER_PHONE = { limit: 5, windowMinutes: 30 };
const PER_IP = { limit: 20, windowMinutes: 30 };

/** Server action arguments come off the wire and are not validated by the
 *  framework — a hand-rolled POST can send anything at all. */
function isPlausibleInput(input: unknown): input is StartOrderInput {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  return (
    typeof i.name === "string" &&
    typeof i.phone === "string" &&
    typeof i.scheduledFor === "number" &&
    Number.isFinite(i.scheduledFor) &&
    Array.isArray(i.lines)
  );
}

export interface StartOrderInput {
  serviceType: OrderServiceType;
  name: string;
  phone: string;
  scheduledFor: number;
  lines: RequestedLine[];
}

export type StartOrderResult =
  | { ok: true; orderId: string; razorpayOrderId: string; amountPaise: number; keyId: string }
  | { ok: false; error: string };

/**
 * Creates the order in `awaiting_payment` — invisible to the manager, the
 * kitchen, history and every total — and opens a Razorpay order for it.
 * Nothing here trusts the browser: the time, the name, the number and above
 * all the prices are all re-derived server-side.
 */
export async function startPhoneOrder(input: StartOrderInput): Promise<StartOrderResult> {
  const now = Date.now();

  if (!isPlausibleInput(input)) return { ok: false, error: "That order didn't come through — try again." };

  if (!isAcceptingOrders(now)) {
    return { ok: false, error: "We've stopped taking orders for now — the kitchen is closed." };
  }
  if (input.serviceType !== "takeaway" && input.serviceType !== "dine_in") {
    return { ok: false, error: "Pick takeaway or dine-in." };
  }

  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: "Please enter your name." };

  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "That doesn't look like an Indian mobile number." };

  if (!isValidPickupTime(now, input.scheduledFor)) {
    return { ok: false, error: "That time isn't available any more — pick another." };
  }

  // Throttled on the identified number and the source IP. Checked after the
  // cheap validation so a malformed flood never reaches the database.
  const ip = clientIp(await headers());
  const [byPhone, byIp] = await Promise.all([
    checkRateLimit({ bucket: "phone_order", key: phone, ...PER_PHONE }),
    checkRateLimit({ bucket: "phone_order", key: `ip:${ip}`, ...PER_IP }),
  ]);
  if (!byPhone.allowed || !byIp.allowed) {
    return { ok: false, error: "That's a lot of orders in a short time — please call us instead." };
  }

  const priced = priceCart(menu, input.lines);
  if ("error" in priced) return { ok: false, error: priced.error };
  const { cart } = priced;

  const supabase = getServiceSupabase();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      source: "phone",
      placed_by: "customer",
      status: "awaiting_payment",
      estimated_prep_minutes: cart.prepMinutes,
      service_type: input.serviceType,
      scheduled_for: new Date(input.scheduledFor).toISOString(),
      customer_name: name,
      payment_status: "pending",
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return { ok: false, error: orderError?.message ?? "Couldn't start that order." };
  }

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(cart.lines.map((l) => ({ ...l, order_id: order.id })));

  if (itemsError) {
    // An order with no items must not survive to be paid for.
    await supabase.from("orders").delete().eq("id", order.id);
    return { ok: false, error: itemsError.message };
  }

  // The number lives in order_contacts, not on the order: public.orders is
  // world-readable through the anon key, and a name plus a mobile number is
  // not something to hand out with a curl. See migration 0009.
  const { error: contactError } = await supabase
    .from("order_contacts")
    .insert({ order_id: order.id, phone });

  if (contactError) {
    await supabase.from("orders").delete().eq("id", order.id);
    return { ok: false, error: contactError.message };
  }

  try {
    // receipt carries our order id — that binding is what proves, later, that
    // a given payment was for this order and not some cheaper one.
    const rzp = await createRazorpayOrder(cart.totalPaise, order.id);
    // Only count against the limit once an order really was created, so a
    // gateway outage can't lock a customer out by burning their quota.
    await Promise.all([
      recordRateLimitEvent("phone_order", phone),
      recordRateLimitEvent("phone_order", `ip:${ip}`),
    ]);
    return {
      ok: true,
      orderId: order.id,
      razorpayOrderId: rzp.id,
      amountPaise: cart.totalPaise,
      keyId: process.env.RAZORPAY_KEY_ID!,
    };
  } catch (e) {
    await supabase.from("orders").delete().eq("id", order.id);
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach the payment gateway." };
  }
}

export type ConfirmResult = { ok: true } | { ok: false; error: string };

/**
 * Called when Razorpay Checkout returns. Confirms with Razorpay directly that
 * the money arrived for this exact order and amount, then makes the order real
 * and puts it in the manager's approval queue.
 */
export async function confirmPhonePayment(args: {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): Promise<ConfirmResult> {
  const supabase = getServiceSupabase();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, order_items(quantity, unit_price)")
    .eq("id", args.orderId)
    .single();

  if (error || !order) return { ok: false, error: "We couldn't find that order." };
  // Already confirmed — a double callback must not re-run anything.
  if (order.status !== "awaiting_payment") return { ok: true };

  const items = (order.order_items ?? []) as { quantity: number; unit_price: number }[];
  const expectedPaise = Math.round(items.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100);

  const verified = await verifyPaymentForOrder({
    ourOrderId: args.orderId,
    razorpayOrderId: args.razorpayOrderId,
    razorpayPaymentId: args.razorpayPaymentId,
    signature: args.signature,
    expectedPaise,
  });
  if (!verified.ok) return { ok: false, error: verified.error };

  // waiting_confirmation here means "waiting for the manager", not the kitchen
  // — the board deliberately excludes unapproved phone orders.
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "waiting_confirmation",
      payment_status: "paid",
      payment_method: "phone_online",
      payment_reference: verified.payment.paymentId,
    })
    .eq("id", args.orderId)
    .eq("status", "awaiting_payment"); // no-op if another callback won the race

  return updateError ? { ok: false, error: updateError.message } : { ok: true };
}
