"use client";

import { useEffect, useRef, useState } from "react";
import { approvePhoneOrder, getOrderPhones, rejectPhoneOrder } from "@/app/manager/actions";
import { money } from "@/lib/cart";
import { orderTotal } from "@/lib/history-report";
import { since } from "@/lib/orders";
import { formatPhone } from "@/lib/phone";
import { clockLabel, pickupSlots } from "@/lib/service-hours";
import type { OrderRow, OrderWithItems } from "@/types/order";

/**
 * A paid phone order waiting on the counter. Money has already changed hands,
 * so this is the one card on the dashboard that must be impossible to ignore —
 * and rejecting means refunding, which is why it's two taps.
 */
export function ApprovalCard({
  order,
  now,
  onApplied,
  onError,
}: {
  order: OrderWithItems;
  now: number;
  onApplied: (patch: Partial<OrderRow>) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [changingTime, setChangingTime] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);

  // The number is in order_contacts, which the browser's key cannot read.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    getOrderPhones([order.id])
      .then((map) => setPhone(map[order.id] ?? null))
      .catch(() => setPhone(null));
  }, [order.id]);

  const requested = order.scheduled_for ? new Date(order.scheduled_for).getTime() : null;
  const slots = pickupSlots(now);

  async function approve(readyBy?: number) {
    setBusy(true);
    const result = await approvePhoneOrder(order.id, readyBy);
    if (result.ok) {
      onApplied({
        status: "confirmed",
        ...(readyBy ? { scheduled_for: new Date(readyBy).toISOString() } : {}),
      });
    } else {
      onError(result.error ?? "Couldn't approve that order.");
    }
    setBusy(false);
    setChangingTime(false);
  }

  async function reject() {
    setBusy(true);
    setConfirmingReject(false);
    const result = await rejectPhoneOrder(order.id);
    // Cancelled either way — a failed refund reports itself but the order is
    // still off the board, so apply the local change regardless.
    onApplied({ status: "cancelled" });
    if (!result.ok) onError(result.error ?? "Couldn't reject that order.");
    setBusy(false);
  }

  return (
    <div className="animate-gc-rise flex flex-col gap-2.5 rounded-xl border-2 border-primary/60 bg-primary/[0.04] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[7px] bg-primary px-2.5 py-1.5 text-[11px] font-extrabold text-surface">
          {order.service_type === "takeaway" ? "PHONE · TAKEAWAY" : "PHONE · DINE-IN"}
        </span>
        <span className="rounded-full bg-veg/[0.15] px-2.5 py-1 text-[10.5px] font-bold text-veg">
          PAID {money(orderTotal(order.order_items))}
        </span>
        <span className="text-[10.5px] font-semibold text-muted">waiting {since(order.created_at, now)}</span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15px] font-extrabold text-ink">{order.customer_name}</span>
        {order.party_size && (
          <span className="text-[12px] font-semibold text-muted">{order.party_size} people</span>
        )}
        {phone && (
          <a href={`tel:${phone}`} className="text-[12.5px] font-bold text-tertiary hover:underline">
            {formatPhone(phone)}
          </a>
        )}
        {requested && (
          <span className="ml-auto rounded-full bg-ink/[0.07] px-2.5 py-1 text-[11.5px] font-bold text-ink">
            wants it by {clockLabel(requested)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-dashed border-ink/[0.16] pt-2">
        {order.order_items.map((it) => (
          <div key={it.id} className="flex items-baseline gap-2 text-[12.5px]">
            <span className="min-w-5 font-extrabold text-primary">{it.quantity}×</span>
            <span className="font-semibold text-ink">
              {it.item_name}
              {it.variant_name ? ` (${it.variant_name})` : ""}
            </span>
          </div>
        ))}
      </div>

      {changingTime ? (
        <div className="flex flex-col gap-1.5 border-t border-dashed border-ink/[0.16] pt-2">
          <span className="text-[10.5px] font-bold tracking-[.12em] text-muted">APPROVE WITH A NEW TIME</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {slots.map((slot) => (
              <button
                key={slot}
                disabled={busy}
                onClick={() => approve(slot)}
                className="flex-none rounded-full border border-ink/[0.16] px-3 py-1.5 text-[11.5px] font-semibold whitespace-nowrap text-ink transition hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {clockLabel(slot)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setChangingTime(false)}
            className="self-start px-1 text-[11px] font-semibold text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-ink/[0.16] pt-2.5">
          <button
            disabled={busy}
            onClick={() => approve()}
            className="rounded-[9px] bg-veg px-4 py-2.5 text-[12px] font-extrabold text-surface transition hover:bg-[#245f27] disabled:opacity-50"
          >
            Accept
          </button>
          <button
            disabled={busy}
            onClick={() => setChangingTime(true)}
            className="rounded-[9px] border border-ink/[0.18] px-3 py-2.5 text-[11.5px] font-bold text-ink transition hover:border-primary hover:text-primary disabled:opacity-50"
          >
            Accept, different time
          </button>

          {confirmingReject ? (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[10.5px] font-semibold text-muted">Refund &amp; reject?</span>
              <button
                disabled={busy}
                onClick={reject}
                className="rounded-[9px] bg-non-veg px-3 py-2.5 text-[11.5px] font-extrabold text-surface disabled:opacity-50"
              >
                Yes, refund
              </button>
              <button
                onClick={() => setConfirmingReject(false)}
                className="px-1.5 text-[11px] font-semibold text-muted hover:text-ink"
              >
                No
              </button>
            </div>
          ) : (
            <button
              disabled={busy}
              onClick={() => setConfirmingReject(true)}
              className="ml-auto px-2 py-2.5 text-[11.5px] font-semibold text-muted transition hover:text-non-veg disabled:opacity-50"
            >
              Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}
