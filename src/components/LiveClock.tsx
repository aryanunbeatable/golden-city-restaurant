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
export function LiveClock({ className = "" }: { className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className={className}>{FORMAT.format(now)} IST</span>;
}
