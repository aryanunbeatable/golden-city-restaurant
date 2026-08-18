"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyManagerPin } from "@/app/manager/actions";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

// Matches the design's mLogin screen exactly, minus the outer device-frame
// bezel — that only existed in the prototype to show customer/manager/
// kitchen side by side on one canvas; a real manager terminal fills its own
// actual browser window. Also drops "Prototype — any PIN unlocks": this
// build checks a real PIN, so that line becomes real error feedback instead.
export function ManagerPinGate() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function press(key: string) {
    setError(null);
    if (key === "C") return setPin("");
    if (key === "⌫") return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length < 4 ? p + key : p));
  }

  function unlock() {
    startTransition(async () => {
      const { ok } = await verifyManagerPin(pin);
      if (ok) {
        router.refresh();
      } else {
        setError("Incorrect PIN — try again.");
        setPin("");
      }
    });
  }

  return (
    <main className="flex min-h-dvh flex-col md:flex-row">
      <div className="flex flex-col justify-center gap-3.5 bg-primary px-8 py-8 text-surface md:flex-1 md:px-[60px] md:py-0">
        <span className="font-display text-[32px] leading-[1.1] md:text-[42px]">
          Golden City
          <br />
          Restaurant
        </span>
        <span className="text-base font-medium text-secondary italic">A Taste to Remember....!!</span>
        <div className="my-2 h-px w-[120px] bg-secondary/50" />
        <span className="text-xs leading-[1.8] font-semibold tracking-[.06em] text-surface/75">
          COUNTER TERMINAL · ORDER ENTRY
          <br />
          Takes over from the handwritten kitchen token
        </span>
      </div>

      <div className="flex w-full flex-1 flex-col items-center justify-center gap-5 px-6 py-8 md:w-[440px] md:flex-none md:px-10 md:py-0">
        <span className="text-[11px] font-bold tracking-[.18em] text-muted">ENTER MANAGER PIN</span>

        <div className="flex gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={
                i < pin.length
                  ? "h-4 w-4 rounded-full bg-primary"
                  : "h-4 w-4 rounded-full border-[1.5px] border-ink/25"
              }
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              className="h-[70px] w-[74px] rounded-[14px] border border-ink/[0.12] bg-surface text-[22px] font-semibold text-ink transition hover:border-primary hover:text-primary sm:w-[84px]"
            >
              {k}
            </button>
          ))}
        </div>

        <button
          onClick={unlock}
          disabled={pin.length !== 4 || pending}
          className="w-full max-w-[276px] rounded-[14px] bg-primary py-4 text-sm font-extrabold text-surface transition hover:bg-[#7A180B] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Checking…" : "Unlock dashboard"}
        </button>

        {error && <span className="text-[11px] font-semibold text-non-veg">{error}</span>}
      </div>
    </main>
  );
}
