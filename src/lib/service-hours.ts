// When the restaurant takes phone orders, and which pickup times it can offer.
// Pure date math, no Supabase or React — see service-hours.check.ts.
//
// Open every day, 11:30 AM to 2:00 AM the following morning (IST, no DST).
// The 4AM business-day cutoff in business-day.ts sits outside that window, so
// one service never straddles two kitchen days.
import { businessDayCutoffMs } from "./business-day.ts";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const OPEN_MINUTE = 11 * 60 + 30; // 11:30 AM, minutes past IST midnight
export const CLOSE_MINUTE = 26 * 60; //     2:00 AM next day, as 26:00
export const MIN_LEAD_MINUTES = 15;
export const SLOT_MINUTES = 15;

/** Minutes past IST midnight, where after-midnight reads as 24:00–26:00 so the
 *  whole service window is one ascending range rather than two. */
function serviceMinute(ms: number): number {
  const ist = new Date(ms + IST_OFFSET_MS);
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  // Anything before the 4AM cutoff belongs to the previous evening's service.
  return m < 4 * 60 ? m + 24 * 60 : m;
}

/** The instant a given service-minute falls on, for the service day `now` is in. */
function instantForServiceMinute(now: number, minute: number): number {
  // The kitchen day starts at 4AM IST; service minutes are measured from the
  // IST midnight that precedes it.
  const midnight = businessDayCutoffMs(now) - 4 * 60 * MINUTE_MS;
  return midnight + minute * MINUTE_MS;
}

/** Is the restaurant open right now? */
export function isOpen(now: number): boolean {
  const m = serviceMinute(now);
  return m >= OPEN_MINUTE && m < CLOSE_MINUTE;
}

/**
 * Can the link accept an order right now? Ordering stops early enough that the
 * 15-minute floor still lands inside opening hours — so the last order goes in
 * at 1:45 AM for a 2:00 AM pickup.
 *
 * The closing side is measured in real milliseconds against the last slot of
 * the night rather than in truncated service minutes. serviceMinute() drops
 * seconds, so a minute-based comparison said "open" at 01:45:30 while the only
 * remaining slot (02:00) was 14m30s away and failed the floor in
 * isValidPickupTime — leaving a 59-second window each night where the customer
 * saw the full menu, an empty time picker and a permanently disabled button
 * with no explanation. Measuring the real gap makes "accepting" and "has at
 * least one slot" the same question.
 */
export function isAcceptingOrders(now: number): boolean {
  if (serviceMinute(now) < OPEN_MINUTE) return false;
  return instantForServiceMinute(now, CLOSE_MINUTE) - now >= MIN_LEAD_MINUTES * MINUTE_MS;
}

/** Selectable ready-by times, as epoch ms, for the service day `now` is in.
 *  Empty when the link is closed. */
export function pickupSlots(now: number): number[] {
  if (!isAcceptingOrders(now)) return [];
  const earliest = serviceMinute(now) + MIN_LEAD_MINUTES;
  const first = Math.ceil(Math.max(earliest, OPEN_MINUTE) / SLOT_MINUTES) * SLOT_MINUTES;
  const slots: number[] = [];
  for (let m = first; m <= CLOSE_MINUTE; m += SLOT_MINUTES) {
    const instant = instantForServiceMinute(now, m);
    // Filtered through the same guard the server will apply, rather than by a
    // parallel calculation. serviceMinute() truncates seconds, so at 11:30:30
    // the "+15 minutes" boundary lands at 11:45 — 14m30s away — and the guard
    // would reject the very slot the picker had just offered. Deriving the
    // list from the guard makes offered ⊆ accepted true by construction.
    if (isValidPickupTime(now, instant)) slots.push(instant);
  }
  return slots;
}

/** Server-side guard: a client can post any timestamp it likes. */
export function isValidPickupTime(now: number, scheduledFor: number): boolean {
  if (!isAcceptingOrders(now)) return false;
  if (scheduledFor - now < MIN_LEAD_MINUTES * MINUTE_MS) return false;
  const m = serviceMinute(scheduledFor);
  if (m < OPEN_MINUTE || m > CLOSE_MINUTE) return false;
  // Same service day as the order itself — no booking tomorrow's dinner.
  return businessDayCutoffMs(scheduledFor) === businessDayCutoffMs(now);
}

/** When the kitchen has to start cooking to hit `scheduledFor`. */
export function cookStartMs(scheduledFor: number, prepMinutes: number): number {
  return scheduledFor - prepMinutes * MINUTE_MS;
}

const IST_CLOCK = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function clockLabel(ms: number): string {
  return IST_CLOCK.format(ms);
}

/** Why the link is shut, phrased for the customer. */
export function closedMessage(now: number): string {
  // Derived from isOpen rather than recomputing the cutoff: still serving but
  // no longer accepting is exactly the late-night case, and deriving it means
  // the two can't drift apart the way the minute-vs-millisecond check did.
  if (isOpen(now)) {
    return "We've stopped taking orders for tonight — the kitchen closes at 2:00 AM. We're back at 11:30 AM.";
  }
  return "We're closed right now. Orders open daily at 11:30 AM and run till 2:00 AM.";
}
