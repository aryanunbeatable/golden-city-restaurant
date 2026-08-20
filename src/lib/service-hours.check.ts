// Runnable self-check: node --experimental-strip-types src/lib/service-hours.check.ts
import assert from "node:assert/strict";
import {
  CLOSE_MINUTE,
  MIN_LEAD_MINUTES,
  clockLabel,
  cookStartMs,
  isAcceptingOrders,
  isOpen,
  isValidPickupTime,
  pickupSlots,
} from "./service-hours.ts";
import { businessDayKey } from "./business-day.ts";

const at = (iso: string) => new Date(iso).getTime();
const MIN = 60 * 1000;

// --- isOpen: 11:30 AM to 2:00 AM ---
assert.equal(isOpen(at("2026-08-18T11:29:00+05:30")), false, "closed a minute before opening");
assert.equal(isOpen(at("2026-08-18T11:30:00+05:30")), true, "open exactly at 11:30");
assert.equal(isOpen(at("2026-08-18T23:00:00+05:30")), true, "open late evening");
assert.equal(isOpen(at("2026-08-19T01:59:00+05:30")), true, "still open at 1:59 AM");
assert.equal(isOpen(at("2026-08-19T02:00:00+05:30")), false, "closed at 2:00 AM sharp");
assert.equal(isOpen(at("2026-08-19T09:00:00+05:30")), false, "closed mid-morning");

// --- isAcceptingOrders: stops 15 min before close ---
assert.equal(isAcceptingOrders(at("2026-08-19T01:45:00+05:30")), true, "last order goes in at 1:45 AM");
assert.equal(isAcceptingOrders(at("2026-08-19T01:46:00+05:30")), false, "no orders after 1:45 AM");
assert.equal(isAcceptingOrders(at("2026-08-18T11:00:00+05:30")), false, "no pre-open ordering");

// --- pickupSlots ---
// Ordering at 11:30 sharp: 15-min floor lands at 11:45, which is a slot boundary.
let slots = pickupSlots(at("2026-08-18T11:30:00+05:30"));
assert.equal(clockLabel(slots[0]), clockLabel(at("2026-08-18T11:45:00+05:30")), "earliest slot is +15 min");
assert.equal(
  clockLabel(slots.at(-1)!),
  clockLabel(at("2026-08-19T02:00:00+05:30")),
  "last slot is the 2:00 AM close",
);
// Every slot must clear the 15-minute floor and sit inside opening hours.
const now1 = at("2026-08-18T11:30:00+05:30");
assert.ok(
  slots.every((s) => s - now1 >= MIN_LEAD_MINUTES * MIN),
  "no slot may breach the 15-minute floor",
);
assert.ok(
  slots.every((s) => isValidPickupTime(now1, s)),
  "every offered slot must pass the server-side guard",
);

// A ragged time rounds up to the next 15-minute boundary, never backwards.
slots = pickupSlots(at("2026-08-18T13:07:00+05:30"));
assert.equal(clockLabel(slots[0]), clockLabel(at("2026-08-18T13:30:00+05:30")), "13:07 + 15 = 13:22 -> 13:30");

// Late-night ordering still works and stops at 2:00 AM.
slots = pickupSlots(at("2026-08-19T01:20:00+05:30"));
assert.deepEqual(
  slots.map(clockLabel),
  [at("2026-08-19T01:45:00+05:30"), at("2026-08-19T02:00:00+05:30")].map(clockLabel),
  "at 1:20 AM two slots remain before the 2:00 AM close",
);

// Closed means no slots at all.
assert.deepEqual(pickupSlots(at("2026-08-18T09:00:00+05:30")), [], "no slots while closed");
assert.deepEqual(pickupSlots(at("2026-08-19T01:46:00+05:30")), [], "no slots after ordering shuts");

// REGRESSION: every offered slot must survive the server-side guard, at times
// that are NOT on a whole minute. The earlier version of this file only ever
// used whole-minute timestamps, which hid a real bug: serviceMinute() drops
// seconds, so on a 15-minute boundary with seconds elapsed the earliest slot
// came out just under the floor and startPhoneOrder() refused the customer's own pick.
for (const iso of [
  "2026-08-18T11:30:30+05:30", // opening minute, mid-minute
  "2026-08-18T13:45:20+05:30", // slot boundary, mid-minute
  "2026-08-18T20:00:45+05:30", // slot boundary, late in the minute
  "2026-08-18T20:07:13+05:30", // ragged minute and seconds
  "2026-08-19T01:44:59+05:30", // one second before ordering shuts
]) {
  const t = at(iso);
  const offered = pickupSlots(t);
  assert.ok(offered.length > 0, `should still offer slots at ${iso}`);
  for (const slot of offered) {
    assert.ok(
      isValidPickupTime(t, slot),
      `slot ${clockLabel(slot)} offered at ${iso} must pass the server guard`,
    );
    assert.ok(
      slot - t >= MIN_LEAD_MINUTES * MIN,
      `slot ${clockLabel(slot)} offered at ${iso} breaches the 15-minute floor`,
    );
  }
}

// --- isValidPickupTime: the guard against a hand-crafted request ---
const now2 = at("2026-08-18T20:00:00+05:30");
assert.equal(isValidPickupTime(now2, at("2026-08-18T20:10:00+05:30")), false, "under the 15-minute floor");
assert.equal(isValidPickupTime(now2, at("2026-08-18T20:15:00+05:30")), true, "exactly 15 minutes out");
assert.equal(isValidPickupTime(now2, at("2026-08-19T03:00:00+05:30")), false, "past closing");
assert.equal(isValidPickupTime(now2, at("2026-08-19T13:00:00+05:30")), false, "tomorrow is not same-day");
assert.equal(isValidPickupTime(now2, at("2026-08-18T19:00:00+05:30")), false, "in the past");

// A 1 AM order for 1:45 AM stays inside the same kitchen day as when it was placed.
const lateOrder = at("2026-08-19T01:00:00+05:30");
const latePickup = at("2026-08-19T01:45:00+05:30");
assert.equal(isValidPickupTime(lateOrder, latePickup), true, "late-night order is valid");
assert.equal(
  businessDayKey(lateOrder),
  businessDayKey(latePickup),
  "order and pickup must share a kitchen day, or the board would never fetch it",
);
assert.equal(businessDayKey(lateOrder), "2026-08-18", "a 1 AM order belongs to the 18th's service");

// --- cookStartMs ---
assert.equal(
  cookStartMs(at("2026-08-18T19:30:00+05:30"), 18),
  at("2026-08-18T19:12:00+05:30"),
  "cooking starts prep-time before the food is due",
);

// Sanity: the close constant really is 2 AM expressed as 26:00.
assert.equal(CLOSE_MINUTE, 26 * 60);

console.log("service-hours.check.ts: all assertions passed");
