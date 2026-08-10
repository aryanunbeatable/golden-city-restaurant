// Runnable self-check: node --experimental-strip-types src/lib/business-day.check.ts
import assert from "node:assert/strict";
import { businessDayCutoffMs, msUntilNextBusinessDay } from "./business-day.ts";

function istIso(iso: string): number {
  return new Date(iso).getTime();
}

// 10AM IST on the 11th -> cutoff is 4AM IST the same day
assert.equal(businessDayCutoffMs(istIso("2026-08-11T04:30:00+05:30")), istIso("2026-08-11T04:00:00+05:30"));

// 2AM IST on the 11th (after midnight, before 4AM) -> cutoff is 4AM IST the 10th
assert.equal(businessDayCutoffMs(istIso("2026-08-11T02:00:00+05:30")), istIso("2026-08-10T04:00:00+05:30"));

// exactly at the cutoff -> that cutoff itself, not the previous day's
assert.equal(businessDayCutoffMs(istIso("2026-08-11T04:00:00+05:30")), istIso("2026-08-11T04:00:00+05:30"));

// month boundary: 2AM IST on the 1st -> cutoff is 4AM IST on the last day of the prior month
assert.equal(businessDayCutoffMs(istIso("2026-09-01T02:00:00+05:30")), istIso("2026-08-31T04:00:00+05:30"));

// msUntilNextBusinessDay always lands exactly one day after the current cutoff
const now = istIso("2026-08-11T10:00:00+05:30");
assert.equal(now + msUntilNextBusinessDay(now), businessDayCutoffMs(now) + 24 * 60 * 60 * 1000);

console.log("business-day.check.ts: all assertions passed");
