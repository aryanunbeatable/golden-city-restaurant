// India has no DST — a fixed UTC+5:30 offset holds year-round.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The most recent 4AM IST at-or-before `now` — start of the current "kitchen
// day" (orders placed after midnight but before 4AM still belong to the
// previous day's service, not a new one).
export function businessDayCutoffMs(now: number): number {
  const istNow = now + IST_OFFSET_MS;
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS;
  const cutoff = istMidnight + 4 * 60 * 60 * 1000 - IST_OFFSET_MS;
  return cutoff > now ? cutoff - DAY_MS : cutoff;
}

export function msUntilNextBusinessDay(now: number): number {
  return businessDayCutoffMs(now) + DAY_MS - now;
}
