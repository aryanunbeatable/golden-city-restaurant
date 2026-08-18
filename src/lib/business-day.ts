// India has no DST — a fixed UTC+5:30 offset holds year-round.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CUTOFF_HOUR_MS = 4 * 60 * 60 * 1000;

// The most recent 4AM IST at-or-before `now` — start of the current "kitchen
// day" (orders placed after midnight but before 4AM still belong to the
// previous day's service, not a new one).
export function businessDayCutoffMs(now: number): number {
  const istNow = now + IST_OFFSET_MS;
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS;
  const cutoff = istMidnight + CUTOFF_HOUR_MS - IST_OFFSET_MS;
  return cutoff > now ? cutoff - DAY_MS : cutoff;
}

export function msUntilNextBusinessDay(now: number): number {
  return businessDayCutoffMs(now) + DAY_MS - now;
}

/** "2026-08-18" — the kitchen day an instant belongs to. An order at 1:30 AM
 *  on the 19th keys to the 18th, matching what the kitchen saw as one shift. */
export function businessDayKey(ms: number): string {
  return new Date(businessDayCutoffMs(ms) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Half-open [startMs, endMs) covering one kitchen day, 4AM IST to 4AM IST. */
export function businessDayRange(key: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${key}T04:00:00+05:30`);
  return { startMs, endMs: startMs + DAY_MS };
}

/** Half-open range covering every kitchen day whose date falls in the month.
 *  `month` is 1-12. */
export function businessMonthRange(year: number, month: number): { startMs: number; endMs: number } {
  const mm = String(month).padStart(2, "0");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startMs: businessDayRange(`${year}-${mm}-01`).startMs,
    endMs: businessDayRange(`${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`).endMs,
  };
}

/** Every day key in the month, in order — the calendar grid's cells. */
export function businessMonthDayKeys(year: number, month: number): string[] {
  const mm = String(month).padStart(2, "0");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`);
}

/** Weekday of a day key, 0=Sunday — how far to indent the first calendar row. */
export function dayKeyWeekday(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}
