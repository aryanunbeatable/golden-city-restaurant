// The "time to head over" sweep. Runs every minute from Supabase Cron.
//
// This is the one trigger with no event behind it: nothing happens when an
// order crosses ten-minutes-before-due, so something has to watch the clock.
// See LEAVE_LEAD_MS in order-clock.ts — the same constant the tracker's banner
// uses, so the notification and the screen can never disagree.
import { getServiceSupabase } from "@/lib/supabase/server";
import { LEAVE_LEAD_MS } from "@/lib/order-clock";
import { sendOrderPush } from "@/lib/push";

/** Don't nudge someone about an order that was due an hour ago — the sweep
 *  would otherwise pick up anything stale that never got marked ready. */
const TOO_LATE_MS = 30 * 60_000;

export async function sweepLeaveNudges(): Promise<number> {
  const now = Date.now();
  const supabase = getServiceSupabase();

  const { data: due, error } = await supabase
    .from("orders")
    .select("id, service_type, scheduled_for")
    .eq("source", "phone")
    .eq("status", "confirmed")
    .is("leave_notified_at", null)
    .lte("scheduled_for", new Date(now + LEAVE_LEAD_MS).toISOString())
    .gte("scheduled_for", new Date(now - TOO_LATE_MS).toISOString());

  if (error) {
    console.error("[leave-nudge] couldn't read due orders:", error.message);
    return 0;
  }
  if (!due?.length) return 0;

  let sent = 0;
  for (const order of due) {
    // Stamped before sending, not after: a push that fails is not worth
    // retrying every minute for half an hour, and a duplicate buzz is worse
    // than a missed one.
    const { error: markError } = await supabase
      .from("orders")
      .update({ leave_notified_at: new Date().toISOString() })
      .eq("id", order.id)
      .is("leave_notified_at", null); // whoever wins the race sends it
    if (markError) continue;

    const ok = await sendOrderPush(order.id, {
      title: "Time to head over 🏃",
      body:
        order.service_type === "takeaway"
          ? "Your order will be at the counter in about 10 minutes."
          : "Your table's food comes out in about 10 minutes.",
      tag: `${order.id}:leave`,
    });
    if (ok) sent++;
  }

  return sent;
}
