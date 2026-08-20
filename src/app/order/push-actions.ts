"use server";

import { getServiceSupabase } from "@/lib/supabase/server";

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function isSubscription(v: unknown): v is BrowserSubscription {
  if (typeof v !== "object" || v === null) return false;
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof s.endpoint === "string" &&
    s.endpoint.startsWith("https://") &&
    typeof s.keys?.p256dh === "string" &&
    typeof s.keys?.auth === "string"
  );
}

/**
 * Stores the browser's push subscription against an order.
 *
 * Public and unauthenticated, like the rest of /order — the order id is the
 * only credential, which is the same bearer-token shape the tracker itself
 * already has. It is a v4 UUID, so it cannot be guessed, and the worst a
 * leaked one buys is the ability to receive that order's own notifications.
 * The order is still checked to exist and be live, so this cannot be used to
 * fill the table with rows pointing at nothing.
 */
export async function savePushSubscription(
  orderId: string,
  subscription: unknown,
): Promise<{ ok: boolean }> {
  if (!isSubscription(subscription)) return { ok: false };

  const supabase = getServiceSupabase();
  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.status === "cancelled" || order.status === "served") return { ok: false };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      order_id: orderId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: "order_id" },
  );

  return { ok: !error };
}
