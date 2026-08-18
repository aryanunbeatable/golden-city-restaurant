// Runnable self-check: node --experimental-strip-types src/lib/business-day.check.ts
import assert from "node:assert/strict";
import {
  businessDayCutoffMs,
  businessDayKey,
  businessDayRange,
  businessMonthDayKeys,
  businessMonthRange,
  dayKeyWeekday,
  msUntilNextBusinessDay,
} from "./business-day.ts";

function at(iso: string): number {
  return new Date(iso).getTime();
}

// --- cutoff ---
// 10AM IST on the 11th -> cutoff is 4AM IST the same day
assert.equal(businessDayCutoffMs(at("2026-08-11T04:30:00+05:30")), at("2026-08-11T04:00:00+05:30"));

// 2AM IST on the 11th (after midnight, before 4AM) -> cutoff is 4AM IST the 10th
assert.equal(businessDayCutoffMs(at("2026-08-11T02:00:00+05:30")), at("2026-08-10T04:00:00+05:30"));

// exactly at the cutoff -> that cutoff itself, not the previous day's
assert.equal(businessDayCutoffMs(at("2026-08-11T04:00:00+05:30")), at("2026-08-11T04:00:00+05:30"));

// month boundary: 2AM IST on the 1st -> cutoff is 4AM IST on the last day of the prior month
assert.equal(businessDayCutoffMs(at("2026-09-01T02:00:00+05:30")), at("2026-08-31T04:00:00+05:30"));

// msUntilNextBusinessDay always lands exactly one day after the current cutoff
const now = at("2026-08-11T10:00:00+05:30");
assert.equal(now + msUntilNextBusinessDay(now), businessDayCutoffMs(now) + 24 * 60 * 60 * 1000);

// --- day keys ---
// a late-night order files under the day the shift started, not the calendar date
assert.equal(businessDayKey(at("2026-08-19T01:30:00+05:30")), "2026-08-18");
assert.equal(businessDayKey(at("2026-08-18T23:59:00+05:30")), "2026-08-18");
assert.equal(businessDayKey(at("2026-08-18T04:00:00+05:30")), "2026-08-18");
// one minute before the cutoff still belongs to the previous day
assert.equal(businessDayKey(at("2026-08-18T03:59:00+05:30")), "2026-08-17");

// --- day range ---
const day = businessDayRange("2026-08-18");
assert.equal(day.startMs, at("2026-08-18T04:00:00+05:30"));
assert.equal(day.endMs, at("2026-08-19T04:00:00+05:30"));
// the range and the key agree at both edges: [start, end)
assert.equal(businessDayKey(day.startMs), "2026-08-18");
assert.equal(businessDayKey(day.endMs - 1), "2026-08-18");
assert.equal(businessDayKey(day.endMs), "2026-08-19");

// --- month range ---
const aug = businessMonthRange(2026, 8);
assert.equal(aug.startMs, at("2026-08-01T04:00:00+05:30"));
assert.equal(aug.endMs, at("2026-09-01T04:00:00+05:30"), "August ends when the 31st's shift ends");

// February in a leap year keeps all 29 days
assert.equal(businessMonthDayKeys(2028, 2).length, 29);
assert.equal(businessMonthDayKeys(2026, 2).length, 28);
assert.equal(businessMonthDayKeys(2026, 8).at(-1), "2026-08-31");

// --- weekday ---
assert.equal(dayKeyWeekday("2026-08-16"), 0, "2026-08-16 is a Sunday");
assert.equal(dayKeyWeekday("2026-08-18"), 2, "2026-08-18 is a Tuesday");

console.log("business-day.check.ts: all assertions passed");
