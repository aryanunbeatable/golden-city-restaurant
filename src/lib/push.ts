// Sending web push. Server-only: the VAPID private key is the credential that
// proves to Google/Mozilla/Apple that a push came from us, and it must never
// reach a bundle.
//
// web-push is a dependency rather than hand-rolled because the Web Push spec
// needs a VAPID ES256 JWT *and* ECDH + HKDF + AES128GCM payload encryption.
// That is a few hundred lines of cryptography that has to be exactly right,
// which is not somewhere to save a dependency.
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase/server";

let configured = false;

/** Returns false when the keys aren't set, so a deploy without them degrades
 *  to "no notifications" rather than throwing inside a kitchen action. */
function configure(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Path the notification opens. Defaults to the order's own tracker. */
  url?: string;
  /** Collapses with any earlier notification carrying the same tag, so a
   *  customer never wakes to a stack of three about one order. */
  tag?: string;
}

/**
 * Best effort by design. A failed notification must never roll back the thing
 * it was announcing — the food really is ready whether or not the phone buzzed.
 * Every caller ignores the return value except tests.
 */
export async function sendOrderPush(
  orderId: string,
  message: PushMessage,
  client?: SupabaseClient,
): Promise<boolean> {
  if (!configure()) return false;

  const supabase = client ?? getServiceSupabase();
  const { data: sub, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("order_id", orderId)
    .maybeSingle();

  if (error || !sub) return false; // customer never opted in

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: message.title,
        body: message.body,
        url: message.url ?? `/order/${orderId}`,
        tag: message.tag ?? orderId,
      }),
    );
    return true;
  } catch (e) {
    // 404/410 mean the browser threw the subscription away — uninstalled,
    // permissions revoked, or expired. Keeping the row would retry forever.
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await supabase.from("push_subscriptions").delete().eq("order_id", orderId);
    } else {
      console.error(`[push] order ${orderId}:`, e instanceof Error ? e.message : e);
    }
    return false;
  }
}
