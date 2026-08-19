// Razorpay over plain REST — the SDK adds a dependency for four calls we can
// make with fetch. Server-only: every function here uses the key secret.
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.razorpay.com/v1";

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set");
  return { keyId, keySecret };
}

function authHeader(): string {
  const { keyId, keySecret } = credentials();
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { error?: { description?: string } }).error?.description ?? `Razorpay ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string; // 'captured' is the only one that means we have the money
}

/** `receipt` carries our own order id, which is how a payment is later bound
 *  back to the order it paid for — see verifyPaymentForOrder(). */
export async function createRazorpayOrder(amountPaise: number, receipt: string): Promise<RazorpayOrder> {
  return call<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, payment_capture: 1 }),
  });
}

export async function fetchPayment(paymentId: string): Promise<RazorpayPayment> {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

export async function fetchOrder(orderId: string): Promise<RazorpayOrder> {
  return call<RazorpayOrder>(`/orders/${encodeURIComponent(orderId)}`);
}

export async function refundPayment(paymentId: string): Promise<{ id: string }> {
  return call<{ id: string }>(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: JSON.stringify({}), // no amount = full refund
  });
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** Razorpay Checkout hands the browser these three values; the signature proves
 *  they came from Razorpay and not from the page's own console. */
export function isValidCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): boolean {
  const { keySecret } = credentials();
  const expected = createHmac("sha256", keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return safeEqualHex(expected, signature);
}

/** Webhook bodies are signed with a different secret, set when the webhook is
 *  created in the dashboard. Returns false when the secret isn't configured —
 *  an unverifiable webhook must never be trusted. */
export function isValidWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

export interface VerifiedPayment {
  paymentId: string;
  amountPaise: number;
}

/**
 * The full check that money actually arrived for *this* order. A valid
 * signature alone only proves Razorpay issued the pair — it says nothing about
 * which order was paid or how much. So we also ask Razorpay directly and
 * confirm the payment is captured, the amount matches what we asked for, and
 * the Razorpay order's receipt is our order id. Without the last check a
 * customer could pay ₹1 on some other order and present that instead.
 */
export async function verifyPaymentForOrder(args: {
  ourOrderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
  expectedPaise: number;
}): Promise<{ ok: true; payment: VerifiedPayment } | { ok: false; error: string }> {
  const { ourOrderId, razorpayOrderId, razorpayPaymentId, signature, expectedPaise } = args;

  if (!isValidCheckoutSignature(razorpayOrderId, razorpayPaymentId, signature)) {
    return { ok: false, error: "Payment signature didn't verify." };
  }

  const payment = await fetchPayment(razorpayPaymentId);
  if (payment.status !== "captured") {
    return { ok: false, error: `Payment is ${payment.status}, not captured.` };
  }
  if (payment.order_id !== razorpayOrderId) {
    return { ok: false, error: "Payment belongs to a different Razorpay order." };
  }
  if (payment.amount !== expectedPaise) {
    return { ok: false, error: "Paid amount doesn't match the order total." };
  }

  const rzpOrder = await fetchOrder(razorpayOrderId);
  if (rzpOrder.receipt !== ourOrderId) {
    return { ok: false, error: "That payment was for a different order." };
  }

  return { ok: true, payment: { paymentId: payment.id, amountPaise: payment.amount } };
}
