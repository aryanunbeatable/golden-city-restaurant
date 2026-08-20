import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepLeaveNudges } from "@/lib/leave-nudge";
import { reconcileStuckPayments } from "@/lib/reconcile-payments";

// Called every minute by Supabase Cron (pg_cron + pg_net). Vercel's own cron
// cannot do this on the Hobby plan: minimum interval is once per day and the
// scheduling precision is +/-59 minutes, which a ten-minute nudge cannot use.
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: unset secret means nobody gets in
  const header = request.headers.get("authorization") ?? "";
  const offered = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

export async function POST(request: Request) {
  // pg_net calls this over the public internet, so it needs a real guard.
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  // Both sweeps are independent; one failing must not skip the other.
  const [nudged, recovered] = await Promise.all([
    sweepLeaveNudges().catch((e) => {
      console.error("[cron] leave sweep failed:", e);
      return 0;
    }),
    // Piggybacks on the same minute: previously this only ran when someone
    // opened the orders board, so money stuck at 11pm sat until morning.
    reconcileStuckPayments().catch((e) => {
      console.error("[cron] reconcile failed:", e);
      return 0;
    }),
  ]);

  return NextResponse.json({ nudged, recovered });
}
