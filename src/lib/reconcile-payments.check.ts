// Runnable self-check: node --experimental-strip-types src/lib/reconcile-payments.check.ts
//
// Covers settleablePayment(), which is the gate between "Razorpay has some
// payments on this order" and "we mark the order paid and cook the food".
// Getting it wrong either loses a real order or feeds someone who didn't pay.
import assert from "node:assert/strict";
import { settleablePayment, type RazorpayPayment } from "./razorpay.ts";
import { GIVE_UP_AFTER_MS, RECHECK_AFTER_MS, STUCK_AFTER_MS } from "./reconcile-payments.ts";

const ORDER = "order_ABC";
const PAISE = 41900;

function payment(over: Partial<RazorpayPayment>): RazorpayPayment {
  return {
    id: "pay_1",
    order_id: ORDER,
    amount: PAISE,
    currency: "INR",
    status: "captured",
    ...over,
  };
}

// The happy path: one captured payment for the right order and amount.
const good = payment({});
assert.equal(settleablePayment([good], ORDER, PAISE), good, "captured + matching should settle");

// Nothing to settle from.
assert.equal(settleablePayment([], ORDER, PAISE), null, "no payments");

// Money that hasn't actually arrived. 'authorized' is the dangerous one: the
// customer sees a debit, but an uncaptured payment auto-refunds.
for (const status of ["failed", "authorized", "created", "refunded"]) {
  assert.equal(settleablePayment([payment({ status })], ORDER, PAISE), null, `must not settle on ${status}`);
}

// Wrong amount, either way. Underpaying is the attack; overpaying is a bug we
// would rather surface than silently accept.
assert.equal(settleablePayment([payment({ amount: 100 })], ORDER, PAISE), null, "underpaid");
assert.equal(settleablePayment([payment({ amount: PAISE + 1 })], ORDER, PAISE), null, "overpaid");

// A captured payment that belongs to some other Razorpay order.
assert.equal(settleablePayment([payment({ order_id: "order_OTHER" })], ORDER, PAISE), null, "other order");

// Real orders retry: failed attempts sit alongside the one that worked, and
// the good one must still be found however they are ordered.
const succeeded = payment({ id: "pay_ok" });
const failed = payment({ id: "pay_bad", status: "failed" });
assert.equal(settleablePayment([failed, succeeded], ORDER, PAISE), succeeded, "picks the captured one");
assert.equal(settleablePayment([succeeded, failed], ORDER, PAISE), succeeded, "order-independent");

// All attempts failed — a customer who tried three times and gave up.
assert.equal(settleablePayment([failed, payment({ id: "b", status: "failed" })], ORDER, PAISE), null, "all failed");

// The three windows have to stay in a sane order or the sweep silently stops
// working: a back-off longer than the give-up window means a candidate is
// never re-checked before it ages out, and a back-off shorter than the
// stuck threshold means the first check fires while the customer's own
// callback is still in flight.
assert.ok(STUCK_AFTER_MS < GIVE_UP_AFTER_MS, "orders must be candidates for longer than they take to become one");
assert.ok(RECHECK_AFTER_MS < GIVE_UP_AFTER_MS, "back-off must allow at least one re-check before giving up");
assert.ok(RECHECK_AFTER_MS >= STUCK_AFTER_MS, "re-checking faster than the stuck threshold just races the customer");

console.log("reconcile-payments: all checks passed");
