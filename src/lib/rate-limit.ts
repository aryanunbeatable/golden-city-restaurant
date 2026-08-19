import { getServiceSupabase } from "@/lib/supabase/server";

export interface RateLimitRule {
  bucket: string;
  key: string;
  /** Maximum events allowed inside the window. */
  limit: number;
  windowMinutes: number;
}

/**
 * Fixed-window counter backed by public.rate_limit_events. Server-only.
 *
 * ponytail: a sliding window would be more precise, but a public ordering
 * endpoint only needs "obviously too many, too fast" — upgrade to a sliding
 * window or Redis if real traffic ever makes the edges matter.
 *
 * Fails OPEN on a database error: a Supabase blip should not stop the
 * restaurant taking orders. The rows this protects are cheap to clean up;
 * refusing every customer is not.
 */
export async function checkRateLimit(rule: RateLimitRule): Promise<{ allowed: boolean }> {
  const supabase = getServiceSupabase();
  const since = new Date(Date.now() - rule.windowMinutes * 60_000).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("bucket", rule.bucket)
    .eq("key", rule.key)
    .gte("created_at", since);

  if (error) return { allowed: true };
  return { allowed: (count ?? 0) < rule.limit };
}

export async function recordRateLimitEvent(bucket: string, key: string): Promise<void> {
  try {
    await getServiceSupabase().from("rate_limit_events").insert({ bucket, key });
  } catch {
    // Never let bookkeeping fail the customer's order.
  }
}

/** Best-effort client IP behind Vercel's proxy. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
