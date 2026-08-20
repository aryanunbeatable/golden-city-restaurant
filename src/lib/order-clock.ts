// Where a scheduled phone order sits between "accepted" and "ready", by the
// clock alone. Pure date math, no React — see order-clock.check.ts.
//
// Deliberately clock-derived rather than status-derived: the kitchen board
// never writes 'preparing' (it writes confirmed, ready, served and nothing
// else), so there is no event marking the moment cooking begins. The customer
// copy hedges to match — "should be cooking now", never "is cooking now".
import { cookStartMs } from "./service-hours.ts";
import type { OrderStatus } from "../types/order.ts";

/** How long before the food is due we tell the customer to set off. */
export const LEAVE_LEAD_MS = 10 * 60_000;

/** Above this a live mm:ss readout is noise, not information. */
const COARSE_ABOVE_MS = 60 * 60_000;

export interface ScheduledPhase {
  /** pre_cook: waiting for the kitchen to start. cooking: inside the prep
   *  window. overrun: past the promised time and still not marked ready. */
  kind: "pre_cook" | "cooking" | "overrun";
  /** To cook-start while pre_cook, to ready while cooking, 0 once overrun. */
  msLeft: number;
  /** 0–1 through the cooking window, for the progress bar. */
  progress: number;
  /** Within LEAVE_LEAD_MS of the promised time — time to set off. */
  leaveNow: boolean;
}

export function scheduledPhase(scheduledFor: number, prepMinutes: number, now: number): ScheduledPhase {
  const cookStart = cookStartMs(scheduledFor, prepMinutes);
  const toReady = scheduledFor - now;
  // A quick dish can be due to leave before it is even due to be cooked: a
  // 3-minute ice cream starts cooking 7 minutes *after* the customer should
  // have set off. So this is checked against the promised time, not the phase.
  const leaveNow = toReady <= LEAVE_LEAD_MS;

  if (now < cookStart) return { kind: "pre_cook", msLeft: cookStart - now, progress: 0, leaveNow };

  if (now < scheduledFor) {
    const window = scheduledFor - cookStart;
    return {
      kind: "cooking",
      msLeft: toReady,
      progress: window > 0 ? Math.min(1, (now - cookStart) / window) : 1,
      leaveNow,
    };
  }

  return { kind: "overrun", msLeft: 0, progress: 1, leaveNow: true };
}

/** "8h 20m" / "20 min" / "" — bare, no preposition. */
function coarse(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  return mins >= 1 ? `${mins} min` : "";
}

/** Kitchen board phrasing: "in 6h 5m", "in 12 min", "any moment". */
export function untilLabel(ms: number): string {
  const label = coarse(ms);
  return label ? `in ${label}` : "any moment";
}

/**
 * The big numeral on a countdown ring. A same-day order can be placed at
 * 11:40 AM for 8:00 PM, and mm:ss over eight hours reads as "500:00" — the
 * same nonsense the kitchen board showed before untilLabel existed. So it
 * stays coarse until the wait is short enough to be worth watching tick.
 */
export function countdownLabel(ms: number): string {
  if (ms <= 0) return "00:00";
  if (ms >= COARSE_ABOVE_MS) return coarse(ms);
  const total = Math.ceil(ms / 1000);
  // Ceiling can carry a sub-second remainder over the hour the check above
  // just cleared — 3,599,500ms rounds to 3600s and rendered "60:00", which no
  // clock shows. Fall back to the coarse form for the rounded value so the
  // display reads 1h, 1h, 59:59 as it counts down rather than 1h, 60:00, 59:59.
  if (total >= 3600) return coarse(total * 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

/**
 * How often the tracker needs to re-render, or null when nothing on screen is
 * derived from the clock at all.
 *
 * A fixed one-second tick re-rendered the whole tracker 28,800 times across an
 * eight-hour wait, and kept doing it after the order was served or cancelled,
 * to redraw a label that changes once a minute at most. The countdown only
 * needs per-second resolution while it is actually showing seconds.
 */
export function trackerTickMs(
  status: OrderStatus,
  scheduledFor: number | null,
  prepMinutes: number,
  now: number,
): number | null {
  // Terminal, or waiting on the counter: nothing here moves with the clock.
  if (status === "cancelled" || status === "waiting_confirmation" || status === "awaiting_payment") {
    return null;
  }
  // The going-cold escalation is measured in whole minutes since ready_at.
  if (status === "ready" || status === "served") return MINUTE_MS;
  if (scheduledFor === null) return null;

  const phase = scheduledPhase(scheduledFor, prepMinutes, now);
  // Past due the ring is pinned at 00:00; only the arrival of 'ready' changes
  // it, and that comes over Realtime rather than from the clock.
  if (phase.kind === "overrun") return MINUTE_MS;
  // Above an hour countdownLabel is coarse and changes once a minute.
  return phase.msLeft >= COARSE_ABOVE_MS ? MINUTE_MS : SECOND_MS;
}
