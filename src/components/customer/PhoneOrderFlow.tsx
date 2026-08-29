"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import type { Menu } from "@/types/menu";
import type { PopularEntry } from "@/lib/popular";
import { MAX_PARTY_SIZE, type OrderServiceType } from "@/types/order";
import { useCart, money } from "@/lib/cart";
import { normalizeName, normalizePhone } from "@/lib/phone";
import { clockLabel, closedMessage, isAcceptingOrders, pickupSlots } from "@/lib/service-hours";
import { MenuBrowser } from "@/components/menu/MenuBrowser";
import { CartSheet } from "@/components/menu/CartSheet";
import { confirmPhonePayment, startPhoneOrder } from "@/app/order/actions";

type Step = "type" | "details" | "menu";

/** What Razorpay Checkout hands back to the success handler. */
interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open: () => void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

/** Prefill only — with OTP off this identifies nobody, it just saves typing. */
const CONTACT_KEY = "gc:phone-contact";

export function PhoneOrderFlow({
  menu,
  popular = [],
  leastOrderedCategoryId = null,
}: {
  menu: Menu;
  popular?: PopularEntry[];
  leastOrderedCategoryId?: string | null;
}) {
  const router = useRouter();
  const cart = useCart();

  const [now, setNow] = useState(() => Date.now());
  const [step, setStep] = useState<Step>("type");
  const [serviceType, setServiceType] = useState<OrderServiceType | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState<number | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  // A started-but-unpaid order, kept so a dismissed payment sheet can be
  // reopened without creating a second order (and burning the rate limit).
  // It carries the cart+time it was priced for; anything else means it is
  // stale and must not be reused, or the customer could pay an old total.
  const [pending, setPending] = useState<{
    orderId: string;
    razorpayOrderId: string;
    amountPaise: number;
    keyId: string;
    signature: string;
  } | null>(null);

  // Drives the closed gate and keeps the slot list from going stale while
  // someone browses the menu for twenty minutes.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Prefill from the last order on this device. Deferred past the effect body
  // on purpose: localStorage can't be read during SSR (it would desync
  // hydration on a controlled input), and setting state synchronously inside
  // an effect is the cascading-render pattern React warns about.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const saved = localStorage.getItem(CONTACT_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved) as { name?: string; phone?: string };
        if (parsed.name) setName(parsed.name);
        if (parsed.phone) setPhone(parsed.phone);
      } catch {
        // A corrupt prefill is not worth failing the page over.
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const slots = useMemo(() => pickupSlots(now), [now]);
  const accepting = isAcceptingOrders(now);

  // Derived, not stored: a slot chosen twenty minutes ago may have lapsed by
  // now, and clearing it from an effect would just cause a cascading render.
  const chosenSlot = scheduledFor !== null && slots.includes(scheduledFor) ? scheduledFor : null;

  // Identity of what the customer is actually buying right now. A pending
  // Razorpay order priced against a different signature is stale.
  const signature = useMemo(
    () => `${chosenSlot ?? "none"}|${cart.lines.map((l) => `${l.key}x${l.qty}`).join(",")}`,
    [chosenSlot, cart.lines],
  );
  const reusablePending = pending && pending.signature === signature ? pending : null;

  if (!accepting) return <ClosedScreen message={closedMessage(now)} />;

  async function payAndPlace() {
    if (!serviceType || !chosenSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      let order = reusablePending;
      if (!order) {
        const result = await startPhoneOrder({
          serviceType,
          name,
          phone,
          scheduledFor: chosenSlot,
          partySize: serviceType === "dine_in" ? partySize : null,
          lines: cart.lines.map((l) => ({
            itemId: l.itemId,
            variantName: l.variantName,
            qty: l.qty,
          })),
        });
        if (!result.ok) {
          setError(result.error);
          setSubmitting(false);
          return;
        }
        order = { ...result, signature };
        setPending(order);
      }

      if (!window.Razorpay) {
        setError("Payment couldn't load — check your connection and try again.");
        setSubmitting(false);
        return;
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.razorpayOrderId,
        amount: order.amountPaise,
        currency: "INR",
        name: "Golden City Restaurant",
        description: serviceType === "takeaway" ? "Takeaway order" : "Dine-in order",
        prefill: { name, contact: phone },
        theme: { color: "#8B1D0E" },
        handler: async (response: RazorpayResponse) => {
          const confirmed = await confirmPhonePayment({
            orderId: order.orderId,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
          if (confirmed.ok) {
            try {
              localStorage.setItem(CONTACT_KEY, JSON.stringify({ name, phone }));
            } catch {
              // Prefill is a convenience; never block the receipt on it.
            }
            router.push(`/order/${order.orderId}`);
          } else {
            // Money may well have left their account — never imply otherwise.
            setError(`${confirmed.error} Please don't pay again — call us and we'll sort it out.`);
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => setSubmitting(false),
        },
      });
      checkout.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
      setSubmitting(false);
    }
  }

  const contactReady = normalizeName(name) !== null && normalizePhone(phone) !== null;
  const partyReady = serviceType !== "dine_in" || (partySize !== null && partySize >= 1);

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onLoad={() => setScriptReady(true)}
        onReady={() => setScriptReady(true)}
      />

      {step === "type" && (
        <TypeStep
          onPick={(t) => {
            setServiceType(t);
            if (t === "takeaway") setPartySize(null);
            setStep("details");
          }}
        />
      )}

      {step === "details" && serviceType && (
        <DetailsStep
          serviceType={serviceType}
          name={name}
          phone={phone}
          partySize={partySize}
          onName={setName}
          onPhone={setPhone}
          onPartySize={setPartySize}
          canContinue={contactReady && partyReady}
          onBack={() => setStep("type")}
          onContinue={() => setStep("menu")}
        />
      )}

      {step === "menu" && (
        <main className="flex h-dvh flex-col overflow-hidden">
          <div className="flex flex-none items-center gap-2.5 border-b border-ink/[0.09] px-[18px] py-3">
            <button onClick={() => setStep("details")} className="text-xl font-bold text-primary">
              ‹
            </button>
            <span className="font-display text-base text-primary">Golden City</span>
            <span className="rounded-md bg-tertiary px-2.5 py-1.5 text-[11px] font-bold tracking-[.04em] text-surface">
              {serviceType === "takeaway" ? "TAKEAWAY" : "DINE-IN"}
            </span>
          </div>
          <MenuBrowser
            menu={menu}
            density="customer"
            className="min-h-0 flex-1"
            cart={cart.lines}
            onAddItem={cart.addItem}
            onBumpItem={cart.bumpItem}
            onOpenCart={() => setCartOpen(true)}
            popular={popular}
            leastOrderedCategoryId={leastOrderedCategoryId}
          />
        </main>
      )}

      {cartOpen && (
        <CartSheet
          lines={cart.lines}
          totals={cart.totals}
          onInc={(key) => cart.bumpItem(key, 1)}
          onDec={(key) => cart.bumpItem(key, -1)}
          onClose={() => setCartOpen(false)}
          onStartCooking={payAndPlace}
          submitting={submitting}
          error={error}
          title="Your order"
          ctaLabel={chosenSlot ? `Pay ${money(cart.totals.cost)} →` : "Pick a time first"}
          submittingLabel="Opening payment…"
          ctaDisabled={!chosenSlot || !scriptReady}
          note="Paid now, online. Your order reaches the kitchen once payment completes."
        >
          <TimePicker slots={slots} selected={chosenSlot} onSelect={setScheduledFor} />
        </CartSheet>
      )}
    </>
  );
}

function ClosedScreen({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-primary/[0.08] font-display text-3xl text-primary">
        GC
      </span>
      <span className="font-display text-[22px] text-primary">Golden City Restaurant</span>
      <p className="max-w-xs text-[13px] leading-[1.7] text-muted">{message}</p>
      <span className="rounded-full border border-secondary/40 bg-secondary/[0.16] px-3.5 py-2 text-[11px] font-bold text-[#8B6C08]">
        Open daily · 11:30 AM – 2:00 AM
      </span>
    </main>
  );
}

function TypeStep({ onPick }: { onPick: (t: OrderServiceType) => void }) {
  return (
    <main className="flex min-h-dvh flex-col gap-6 px-6 py-10">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col gap-1.5 text-center">
          <span className="font-display text-[26px] text-primary">Golden City Restaurant</span>
          <span className="text-[12.5px] text-muted">Order ahead — we&apos;ll have it ready when you arrive.</span>
        </div>

        {/* Takeaway first and visually heavier: it is almost all of this traffic. */}
        <button
          onClick={() => onPick("takeaway")}
          className="flex flex-col gap-1.5 rounded-2xl bg-primary px-6 py-7 text-left text-surface shadow-[0_12px_28px_rgba(139,29,14,0.28)] transition hover:bg-[#7A180B]"
        >
          <span className="text-[19px] font-extrabold">Takeaway</span>
          <span className="text-[12.5px] leading-[1.6] text-surface/80">
            Pick a time, pay now, collect at the counter — no waiting.
          </span>
        </button>

        <button
          onClick={() => onPick("dine_in")}
          className="flex flex-col gap-1.5 rounded-2xl border border-ink/[0.16] bg-surface px-6 py-6 text-left transition hover:border-primary"
        >
          <span className="text-[17px] font-bold text-ink">Dine-in</span>
          <span className="text-[12px] leading-[1.6] text-muted">
            Eating with us? Order ahead so your food lands as you sit down.
          </span>
        </button>
      </div>

      {/* First-timers land here with no context for the app — a plain
          reassurance line does more for trust than the blank space it
          replaces. */}
      <p className="text-center text-[12px] leading-[1.6] text-muted">
        No account, no app to install — just your name and number when you order.
      </p>
    </main>
  );
}

function DetailsStep({
  serviceType,
  name,
  phone,
  partySize,
  onName,
  onPhone,
  onPartySize,
  canContinue,
  onBack,
  onContinue,
}: {
  serviceType: OrderServiceType;
  name: string;
  phone: string;
  partySize: number | null;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onPartySize: (v: number) => void;
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const field =
    "w-full rounded-xl border border-ink/[0.16] bg-surface px-3.5 py-3 text-[14px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-muted focus:border-primary";

  return (
    <main className="flex min-h-dvh flex-col gap-5 px-6 py-8">
      <div className="flex items-center gap-2.5">
        <button onClick={onBack} className="text-xl font-bold text-primary">
          ‹
        </button>
        <span className="font-display text-lg text-primary">
          {serviceType === "takeaway" ? "Takeaway" : "Dine-in"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[19px] font-extrabold text-ink">Who&apos;s this order for?</span>
        <span className="text-[12px] leading-[1.6] text-muted">
          We&apos;ll call your name out when it&apos;s ready.
        </span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-[.14em] text-muted">NAME</span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-[.14em] text-muted">MOBILE NUMBER</span>
        <input
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
          placeholder="98765 43210"
          inputMode="numeric"
          autoComplete="tel"
          className={field}
        />
        <span className="text-[12px] leading-[1.5] text-muted">
          So we can reach you about this order — no account, no OTP, just a call if
          something changes.
        </span>
      </label>

      {serviceType === "dine_in" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold tracking-[.14em] text-muted">HOW MANY PEOPLE?</span>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => onPartySize(n)}
                className={
                  partySize === n
                    ? "h-11 w-11 rounded-xl bg-primary text-[15px] font-extrabold text-surface"
                    : "h-11 w-11 rounded-xl border border-ink/[0.16] bg-surface text-[15px] font-semibold text-ink transition hover:border-primary"
                }
              >
                {n}
              </button>
            ))}
            <input
              type="number"
              min={9}
              max={MAX_PARTY_SIZE}
              value={partySize && partySize > 8 ? partySize : ""}
              onChange={(e) => onPartySize(Number(e.target.value))}
              placeholder="9+"
              className="h-11 w-16 rounded-xl border border-ink/[0.16] bg-surface text-center text-[14px] font-semibold text-ink outline-none placeholder:text-muted focus:border-primary"
            />
          </div>
          <span className="text-[11px] text-muted">
            We can&apos;t hold a table in advance — this just helps us plan.
          </span>
        </div>
      )}

      <button
        onClick={onContinue}
        disabled={!canContinue}
        className="mt-auto rounded-2xl bg-primary py-4 text-[15px] font-extrabold text-surface transition hover:bg-[#7A180B] disabled:cursor-not-allowed disabled:bg-ink/[0.12] disabled:text-muted"
      >
        See the menu →
      </button>
    </main>
  );
}

function TimePicker({
  slots,
  selected,
  onSelect,
}: {
  slots: number[];
  selected: number | null;
  onSelect: (ms: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-ink/[0.09] bg-surface px-3.5 py-[13px]">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold tracking-[.04em] text-muted">READY BY</span>
        {selected && <span className="text-[12px] font-extrabold text-primary">{clockLabel(selected)}</span>}
      </div>
      {slots.length === 0 ? (
        <span className="py-2 text-[11.5px] leading-[1.6] text-muted">
          No pickup times left tonight — the kitchen closes at 2:00 AM.
        </span>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {slots.map((slot) => (
            <button
              key={slot}
              onClick={() => onSelect(slot)}
              className={
                slot === selected
                  ? "flex-none rounded-full bg-primary px-3.5 py-2 text-[11.5px] font-extrabold whitespace-nowrap text-surface"
                  : "flex-none rounded-full border border-ink/[0.16] px-3.5 py-2 text-[11.5px] font-semibold whitespace-nowrap text-ink transition hover:border-primary"
              }
            >
              {clockLabel(slot)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
