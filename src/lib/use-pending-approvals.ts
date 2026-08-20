"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { businessDayCutoffMs } from "@/lib/business-day";

/**
 * How many paid phone orders are waiting on the counter to accept them.
 *
 * Lives in a hook rather than on the orders page because the point of the
 * badge is seeing it from somewhere else — usually mid-way through keying in
 * a counter order. Money has already changed hands by the time an order
 * counts here, so it should be hard to miss.
 */
export function usePendingApprovals(): number {
  const [count, setCount] = useState(0);
  const seeded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch {
      return;
    }

    async function refresh() {
      const { count: n, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("source", "phone")
        .eq("status", "waiting_confirmation")
        .eq("payment_status", "paid")
        .gte("created_at", new Date(businessDayCutoffMs(Date.now())).toISOString());
      if (!cancelled && !error) setCount(n ?? 0);
    }

    // Deferred so the first count doesn't land synchronously inside the effect.
    Promise.resolve().then(() => {
      if (!cancelled) {
        seeded.current = true;
        void refresh();
      }
    });

    const channel = supabase
      .channel("manager:approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        if (seeded.current) void refresh();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}

/**
 * Short chime for a newly arrived approval. Synthesised rather than shipped as
 * an asset — it's two sine blips. Browsers block audio until the page has been
 * interacted with, which the PIN unlock already satisfies.
 */
export function playApprovalChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    [0, 0.18].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = i === 0 ? 784 : 1046;
      osc.type = "sine";
      const at = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.start(at);
      osc.stop(at + 0.18);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // Sound is a nicety; never let it break the dashboard.
  }
}
