import Link from "next/link";
import { TABLE_IDS } from "@/lib/table";

// Fallback landing for guests without a table-specific QR code. Real QR
// codes point straight at /table/[id] and skip this grid entirely.
//
// ponytail: table status is static "Ready to order" — there's no order data
// to query yet (order placement isn't built). Wire this to a live count of
// non-ready orders per table once that exists.
export default function TableSelector() {
  return (
    <main className="flex min-h-screen flex-col gap-[26px] px-6 pt-[34px] pb-7">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-[11px] font-semibold tracking-[.24em] text-muted">
          SCAN COMPLETE · WELCOME TO
        </span>
        <span className="font-display text-[30px] leading-[1.1] text-primary">
          Golden City
          <br />
          Restaurant
        </span>
        <span className="text-[13px] italic font-medium text-secondary">
          A Taste to Remember....!!
        </span>
      </div>

      <div className="h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />

      <div className="text-center text-[11px] font-semibold tracking-[.14em] text-muted">
        CONFIRM YOUR TABLE
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        {TABLE_IDS.map((n) => (
          <Link
            key={n}
            href={`/table/${n}`}
            className="flex aspect-square flex-col items-center justify-center gap-[9px] rounded-[20px] border border-primary/[0.18] bg-surface shadow-[0_2px_10px_rgba(42,27,18,0.06)] transition hover:-translate-y-0.5 hover:border-primary hover:shadow-[0_8px_22px_rgba(139,29,14,0.16)] active:translate-y-0"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-secondary font-display text-xl text-primary">
              {n}
            </span>
            <span className="text-[13px] font-bold text-ink">Table {n}</span>
            <span className="text-[11px] font-medium text-muted">Ready to order</span>
          </Link>
        ))}
      </div>

      <div className="mt-auto text-center text-[11px] leading-relaxed text-muted">
        Order from your seat · pay at the counter
        <br />
        No app download needed
      </div>
    </main>
  );
}
