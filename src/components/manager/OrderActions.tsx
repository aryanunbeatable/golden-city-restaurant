"use client";

import { useState } from "react";
import { delayOrder, settleOrderPayment, voidOrder as voidOrderAction } from "@/app/manager/actions";
import {
  COUNTER_PAYMENT_OPTIONS,
  paymentLabel,
  type OrderRow,
  type OrderStatus,
  type PaymentMethod,
} from "@/types/order";

export const STATUS_STYLE: Record<OrderStatus, { label: string; className: string }> = {
  // Present for completeness only — every query that feeds these screens
  // filters awaiting_payment out, because an abandoned checkout is not an
  // order and must never reach a total.
  awaiting_payment: {
    label: "Unpaid",
    className: "border border-ink/20 bg-ink/[0.07] text-muted",
  },
  waiting_confirmation: {
    label: "Waiting",
    className: "border border-secondary/45 bg-secondary/[0.18] text-[#8B6C08]",
  },
  confirmed: { label: "Confirmed", className: "bg-tertiary text-surface" },
  preparing: { label: "Preparing", className: "bg-tertiary text-surface" },
  ready: { label: "Ready", className: "bg-primary text-surface" },
  served: { label: "Served", className: "bg-veg text-surface" },
  cancelled: { label: "Voided", className: "border border-ink/20 bg-ink/[0.07] text-muted" },
};

// Settling and voiding, shared by the live orders list and history — the same
// mistake gets caught during the shift or a week later, and it's the same fix.
// Voiding is two-tap rather than a modal: cheaper, and still not something you
// can do by brushing past the button.
export function OrderActions({
  order,
  onApplied,
  onError,
}: {
  order: OrderRow;
  onApplied: (patch: Partial<OrderRow>) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [choosingDelay, setChoosingDelay] = useState(false);

  // Only a scheduled order can run late — everything else has no promised time
  // to move, and no customer waiting on one.
  const canDelay =
    order.source === "phone" && !!order.scheduled_for && (order.status === "confirmed" || order.status === "preparing");

  const voided = order.status === "cancelled";
  const settled = order.payment_status === "paid";

  // Payment and void writes go through server actions holding the service-role
  // key — the browser's anon key has no write access to payment columns.
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, patch: Partial<OrderRow>) {
    setBusy(true);
    try {
      const result = await fn();
      if (result.ok) onApplied(patch);
      else onError(result.error ?? "That didn't go through — try again.");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function settle(method: PaymentMethod) {
    return run(() => settleOrderPayment(order.id, method), {
      payment_method: method,
      payment_status: "paid",
    });
  }

  function voidOrder() {
    setConfirmingVoid(false);
    return run(() => voidOrderAction(order.id), { status: "cancelled" });
  }

  function delay(minutes: number) {
    setChoosingDelay(false);
    const moved = new Date(new Date(order.scheduled_for!).getTime() + minutes * 60_000).toISOString();
    return run(() => delayOrder(order.id, minutes), { scheduled_for: moved, leave_notified_at: null });
  }

  if (voided) {
    return <span className="text-[11px] font-semibold text-muted">Voided</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {settled ? (
        <span className="rounded-full border border-veg/40 bg-veg/[0.12] px-2.5 py-1.5 text-[11px] font-bold text-veg">
          {paymentLabel(order.payment_method, order.payment_status)}
        </span>
      ) : (
        COUNTER_PAYMENT_OPTIONS.map((p) => (
          <button
            key={p.value}
            disabled={busy}
            onClick={() => settle(p.value)}
            className="rounded-lg border border-ink/[0.16] px-2.5 py-1.5 text-[11px] font-bold text-ink transition hover:border-veg hover:text-veg disabled:opacity-50"
          >
            {p.label}
          </button>
        ))
      )}
      {canDelay &&
        (choosingDelay ? (
          <>
            <span className="text-[10.5px] font-bold tracking-[.1em] text-muted">LATE BY</span>
            {[10, 15, 30].map((m) => (
              <button
                key={m}
                disabled={busy}
                onClick={() => delay(m)}
                className="rounded-lg border border-secondary/50 bg-secondary/[0.12] px-2.5 py-1.5 text-[11px] font-bold text-[#8B6C08] transition hover:border-secondary disabled:opacity-50"
              >
                +{m}m
              </button>
            ))}
            <button
              onClick={() => setChoosingDelay(false)}
              className="rounded-lg px-1.5 py-1.5 text-[11px] font-semibold text-muted hover:text-ink"
            >
              No
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={() => setChoosingDelay(true)}
            className="rounded-lg border border-ink/[0.16] px-2.5 py-1.5 text-[11px] font-bold text-ink transition hover:border-secondary hover:text-[#8B6C08] disabled:opacity-50"
          >
            Running late
          </button>
        ))}
      {confirmingVoid ? (
        <>
          <button
            disabled={busy}
            onClick={voidOrder}
            className="rounded-lg bg-non-veg px-2.5 py-1.5 text-[11px] font-extrabold text-surface disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirmingVoid(false)}
            className="rounded-lg px-1.5 py-1.5 text-[11px] font-semibold text-muted hover:text-ink"
          >
            No
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirmingVoid(true)}
          className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted transition hover:text-non-veg"
        >
          Void
        </button>
      )}
    </div>
  );
}
