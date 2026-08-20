// Runnable self-check: node --experimental-strip-types src/lib/order-clock.check.ts
//
// Four boundaries decide what the customer is looking at — cook-start, the
// promised time, the leave-now lead, and the point where mm:ss stops meaning
// anything. Each one is off-by-one territory, so each one is pinned here.
import assert from "node:assert/strict";
import { LEAVE_LEAD_MS, countdownLabel, scheduledPhase, trackerTickMs, untilLabel } from "./order-clock.ts";

const at = (iso: string) => new Date(iso).getTime();
const MIN = 60_000;

// A ₹419 order due at 5:00 pm, slowest dish 10 minutes -> cooking from 4:50.
const READY = at("2026-08-20T17:00:00+05:30");
const PREP = 10;
const phase = (iso: string) => scheduledPhase(READY, PREP, at(iso));

// --- pre_cook: accepted, nothing happening yet ---
assert.equal(phase("2026-08-20T16:31:00+05:30").kind, "pre_cook", "19 min out is pre_cook");
assert.equal(phase("2026-08-20T16:31:00+05:30").msLeft, 19 * MIN, "counts down to cook-start, not to ready");
assert.equal(phase("2026-08-20T16:31:00+05:30").progress, 0, "no cooking progress before cooking");

// --- the cook-start boundary ---
assert.equal(phase("2026-08-20T16:49:59+05:30").kind, "pre_cook", "one second before cook-start");
assert.equal(phase("2026-08-20T16:50:00+05:30").kind, "cooking", "cook-start exactly");

// --- cooking: now counting to the promised time ---
const mid = phase("2026-08-20T16:55:00+05:30");
assert.equal(mid.kind, "cooking");
assert.equal(mid.msLeft, 5 * MIN, "counts down to ready");
assert.equal(mid.progress, 0.5, "halfway through the prep window");

// --- the promised time, still not marked ready ---
assert.equal(phase("2026-08-20T16:59:59+05:30").kind, "cooking", "one second before due");
assert.equal(phase("2026-08-20T17:00:00+05:30").kind, "overrun", "due and not ready is overrun");
assert.equal(phase("2026-08-20T17:20:00+05:30").kind, "overrun", "stays overrun");
assert.equal(phase("2026-08-20T17:20:00+05:30").msLeft, 0, "never counts negative");

// --- leaveNow fires off the promised time, not the phase ---
assert.equal(phase("2026-08-20T16:49:00+05:30").leaveNow, false, "11 min out: not yet");
assert.equal(phase("2026-08-20T16:50:00+05:30").leaveNow, true, "exactly 10 min out");
assert.equal(phase("2026-08-20T16:55:00+05:30").leaveNow, true, "5 min out");
assert.equal(phase("2026-08-20T17:05:00+05:30").leaveNow, true, "overrun still means go");

// A 3-minute ice cream is the case that breaks a phase-based leave nudge:
// cooking starts at 4:57, but the customer should have left at 4:50. So
// leaveNow must be able to be true while still pre_cook.
const quick = scheduledPhase(READY, 3, at("2026-08-20T16:52:00+05:30"));
assert.equal(quick.kind, "pre_cook", "3-min dish has not started cooking yet");
assert.equal(quick.leaveNow, true, "but it is already time to set off");

// Degenerate prep: must not divide by zero or report NaN progress.
const zero = scheduledPhase(READY, 0, at("2026-08-20T16:59:00+05:30"));
assert.ok(Number.isFinite(zero.progress), "zero-length cook window must not produce NaN");

// --- countdownLabel: mm:ss when it is worth watching, coarse when it is not ---
assert.equal(countdownLabel(19 * MIN), "19:00", "under an hour ticks");
assert.equal(countdownLabel(90 * 1000), "01:30", "seconds are padded");
assert.equal(countdownLabel(59 * MIN + 59_000), "59:59", "just under the switch");
// The bug this exists to prevent: 8h20m as mm:ss reads "500:00".
assert.equal(countdownLabel(8 * 60 * MIN + 20 * MIN), "8h 20m", "long waits go coarse");
assert.equal(countdownLabel(60 * MIN), "1h", "exactly an hour is coarse, and drops a bare 0m");
// REGRESSION: Math.ceil used to carry a sub-second remainder over the hour the
// coarse check had just cleared, rendering "60:00" for half a second.
assert.equal(countdownLabel(3_599_500), "1h", "rounding past the hour must not render 60:00");
assert.equal(countdownLabel(3_599_999), "1h", "same, at the very top of the second");
assert.equal(countdownLabel(3_599_000), "59:59", "a whole second below still ticks");
assert.equal(countdownLabel(0), "00:00", "zero");
assert.equal(countdownLabel(-5000), "00:00", "never renders a negative clock");

// --- untilLabel keeps the kitchen board's existing phrasing ---
assert.equal(untilLabel(6 * 60 * MIN + 5 * MIN), "in 6h 5m");
assert.equal(untilLabel(2 * 60 * MIN), "in 2h");
assert.equal(untilLabel(12 * MIN), "in 12 min");
assert.equal(untilLabel(30_000), "any moment", "under a minute is not a number");

assert.equal(LEAVE_LEAD_MS, 10 * MIN);

// --- trackerTickMs: re-render only as fast as something actually changes ---
// Finished or not yet started: nothing on screen is derived from the clock.
for (const status of ["cancelled", "waiting_confirmation", "awaiting_payment"] as const) {
  assert.equal(trackerTickMs(status, READY, PREP, at("2026-08-20T16:31:00+05:30")), null, `${status} needs no tick`);
}
// Sat at the counter: the going-cold copy steps in whole minutes.
assert.equal(trackerTickMs("ready", READY, PREP, at("2026-08-20T17:05:00+05:30")), 60_000, "ready ticks per minute");
assert.equal(trackerTickMs("served", READY, PREP, at("2026-08-20T17:05:00+05:30")), 60_000, "served ticks per minute");
// The case this exists for: an 8-hour wait must not redraw every second.
const farOff = at("2026-08-20T09:00:00+05:30");
assert.equal(trackerTickMs("confirmed", READY, PREP, farOff), 60_000, "a multi-hour wait shows a coarse label");
// Close in, the ring is showing seconds and has to keep up.
assert.equal(trackerTickMs("confirmed", READY, PREP, at("2026-08-20T16:31:00+05:30")), 1_000, "under an hour ticks per second");
assert.equal(trackerTickMs("confirmed", READY, PREP, at("2026-08-20T16:55:00+05:30")), 1_000, "still per second while cooking");
// Past due the ring is pinned at 00:00; 'ready' arrives over Realtime.
assert.equal(trackerTickMs("confirmed", READY, PREP, at("2026-08-20T17:30:00+05:30")), 60_000, "overrun needs no per-second redraw");
// No promised time at all (defensive branch in the tracker).
assert.equal(trackerTickMs("confirmed", null, PREP, farOff), null, "nothing to count down to");

console.log("order-clock.check.ts: all assertions passed");
