"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import {
  KITCHEN_SESSION_COOKIE,
  KITCHEN_SESSION_TTL_MS,
  createSessionCookieValue,
  isValidSessionCookieValue,
} from "@/lib/kitchen-session";
import { getServiceSupabase } from "@/lib/supabase/server";
import { sendOrderPush } from "@/lib/push";

export async function verifyKitchenPin(pin: string): Promise<{ ok: boolean }> {
  const expected = process.env.KITCHEN_PIN;
  const value = expected ? createSessionCookieValue() : null;
  // Missing env config fails closed (nobody gets in) rather than open.
  if (!expected || !value || pin !== expected) return { ok: false };

  const store = await cookies();
  store.set(KITCHEN_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: KITCHEN_SESSION_TTL_MS / 1000,
    path: "/kitchen",
  });
  return { ok: true };
}

export async function signOutKitchen(): Promise<void> {
  const store = await cookies();
  store.delete({ name: KITCHEN_SESSION_COOKIE, path: "/kitchen" });
}

// Same reasoning as the manager's actions: a server action is a public
// endpoint, so being rendered behind the kitchen PIN proves nothing about who
// is calling it.
async function isKitchen(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionCookieValue(store.get(KITCHEN_SESSION_COOKIE)?.value);
}

/**
 * Marking an order ready — the one status change a customer is waiting on.
 *
 * The kitchen board writes every other status straight to Supabase with the
 * anon key, and could write this one too. But a push needs the VAPID private
 * key, which can never be in the kitchen bundle. So this single transition
 * gets a server side and the board keeps its direct writes for the rest.
 */
export async function markOrderReady(orderId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await isKitchen())) return { ok: false, error: "Not signed in." };

  const supabase = getServiceSupabase();
  const { data: order, error } = await supabase
    .from("orders")
    .update({ status: "ready" })
    .eq("id", orderId)
    // Mirrors isCooking on the board. Not .neq("status","ready"): that also
    // matches a cancelled order, so a stale kitchen card could resurrect one
    // that the manager had already rejected and refunded, and push "your order
    // is ready" to that customer. The board has no reconnect handling, so a
    // stale card is a real possibility rather than a theoretical one.
    .in("status", ["confirmed", "preparing"])
    .select("id, source, service_type")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  // Matched nothing: already ready, or cancelled underneath us. Either way
  // there is nothing to do and nothing to announce.
  if (!order) return { ok: true };

  if (order.source === "phone") {
    // after() so a slow push service can never hold up the pass. The food is
    // ready whether or not the phone buzzes.
    after(async () => {
      await sendOrderPush(orderId, {
        title: "Your order is ready 🔔",
        body:
          order.service_type === "takeaway"
            ? "Packed and waiting at the counter — best eaten hot."
            : "Your table's food is coming out now.",
      });
    });
  }

  return { ok: true };
}
