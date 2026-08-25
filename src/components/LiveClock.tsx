"use client";

import { useEffect, useState } from "react";

const FORMAT = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

// IST is a fixed UTC+5:30 offset (no DST), so a plain Intl formatter tracking
// wall-clock time is all this needs — no timezone library required.
//
// suppressHydrationWarning is the point of interest here. The server renders
// the time at request, the client hydrates a moment later, and the two can
// never agree — which React reports as a hydration error and recovers from by
// throwing the tree away and re-rendering. A timestamp is the case React
// documents this escape hatch for.
//
// The alternative (render nothing until mounted) was rejected: it trades a
// correct, sub-second-stale time for an empty gap that pops in on every page
// load. Both server and client format to Asia/Kolkata, so what SSR emits is
// already right — it is only ever a fraction of a second behind, and the
// interval below corrects it within 1s.
//
// Single template child, not `{...} IST`: two text children hydrate as two
// nodes, and the suppression is clearest when there is exactly one.
export function LiveClock({ className = "" }: { className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={className} suppressHydrationWarning>
      {`${FORMAT.format(now)} IST`}
    </span>
  );
}
