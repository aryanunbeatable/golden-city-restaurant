import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// Lazy on purpose: constructing eagerly at module scope would throw the
// moment any page importing this (even transitively) loads its JS bundle —
// including pages that never actually call Supabase yet. Deferring the
// missing-env check to first real use means the app still renders without
// .env.local configured; only the action that needs Supabase fails.
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill them in.",
    );
  }
  client = createClient(url, anonKey);
  return client;
}
