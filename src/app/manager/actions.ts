"use server";

import { cookies } from "next/headers";
import {
  MANAGER_SESSION_COOKIE,
  MANAGER_SESSION_TTL_MS,
  createSessionCookieValue,
  isValidSessionCookieValue,
} from "@/lib/manager-session";
import { getServiceSupabase } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/types/order";

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
  if (!(await isManager())) return { ok: false, error: "Session expired — unlock the dashboard again." };
  if (!SETTLEABLE.includes(method)) return { ok: false, error: "Unsupported payment method." };

  const { error } = await getServiceSupabase()
    .from("orders")
    .update({ payment_method: method, payment_status: "paid" })
    .eq("id", orderId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Void an order. Kept, never deleted, and excluded from every total. */
export async function voidOrder(orderId: string): Promise<ActionResult> {
  if (!(await isManager())) return { ok: false, error: "Session expired — unlock the dashboard again." };

  const { error } = await getServiceSupabase()
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
