// Runnable self-check: node --experimental-strip-types src/lib/phone.check.ts
import assert from "node:assert/strict";
import { formatPhone, normalizeName, normalizePhone } from "./phone.ts";

// Every way a customer might type the same number must land on one string,
// because the OTP row, the cookie and the order all key off it.
const same = [
  "9876543210",
  "+91 98765 43210",
  "+919876543210",
  "09876543210",
  "91 9876543210",
  " 98765-43210 ",
  "(98765) 43210",
];
for (const raw of same) {
  assert.equal(normalizePhone(raw), "+919876543210", `should normalise: ${raw}`);
}

// Rejections
assert.equal(normalizePhone("5876543210"), null, "Indian mobiles never start with 5");
assert.equal(normalizePhone("987654321"), null, "too short");
assert.equal(normalizePhone("98765432100"), null, "too long");
assert.equal(normalizePhone(""), null, "empty");
assert.equal(normalizePhone("abcdefghij"), null, "no digits");
assert.equal(normalizePhone("+1 415 555 0100"), null, "non-Indian number");

// Display
assert.equal(formatPhone("+919876543210"), "98765 43210");

// Names
assert.equal(normalizeName("  Aryan   Gupta "), "Aryan Gupta", "collapses whitespace");
assert.equal(normalizeName("A"), null, "one character is not a name");
assert.equal(normalizeName(""), null, "empty");
assert.equal(normalizeName("x".repeat(41)), null, "too long for a kitchen card");
assert.equal(normalizeName("x".repeat(40))?.length, 40, "40 is the limit, inclusive");

console.log("phone.check.ts: all assertions passed");
