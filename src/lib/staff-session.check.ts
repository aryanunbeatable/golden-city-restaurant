// Runnable self-check: node --experimental-strip-types src/lib/staff-session.check.ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createStaffSessionCookieValue, isValidStaffSessionCookieValue } from "./staff-session.ts";

// --- generic engine ---
const secret = "test-secret";
const value = createStaffSessionCookieValue(secret);
assert.ok(value, "should produce a cookie value when a secret is provided");
assert.ok(isValidStaffSessionCookieValue(value!, secret), "freshly created session should validate");

assert.equal(isValidStaffSessionCookieValue(undefined, secret), false, "no cookie should not validate");
assert.equal(isValidStaffSessionCookieValue("garbage", secret), false, "malformed cookie should not validate");
assert.equal(
  isValidStaffSessionCookieValue(value!.slice(0, -1) + (value!.at(-1) === "0" ? "1" : "0"), secret),
  false,
  "tampered signature should not validate",
);

const expiredPayload = String(Date.now() - 1000);
const expiredSig = createHmac("sha256", secret).update(expiredPayload).digest("hex");
assert.equal(
  isValidStaffSessionCookieValue(`${expiredPayload}.${expiredSig}`, secret),
  false,
  "expired session should not validate",
);

assert.equal(createStaffSessionCookieValue(undefined), null, "no secret configured => cannot mint a session");
assert.equal(isValidStaffSessionCookieValue(value!, undefined), false, "no secret configured => fail closed");

// --- manager/kitchen wrappers must stay isolated: different secrets, no
// cross-role validation, even though both use the exact same token shape ---
process.env.MANAGER_SESSION_SECRET = "manager-secret";
process.env.KITCHEN_SESSION_SECRET = "kitchen-secret";
const { createSessionCookieValue: createManagerCookie, isValidSessionCookieValue: isValidManagerCookie } =
  await import("./manager-session.ts");
const { createSessionCookieValue: createKitchenCookie, isValidSessionCookieValue: isValidKitchenCookie } =
  await import("./kitchen-session.ts");

const managerCookie = createManagerCookie();
const kitchenCookie = createKitchenCookie();
assert.ok(managerCookie && kitchenCookie, "both wrappers should mint a cookie once their secret is set");
assert.ok(isValidManagerCookie(managerCookie!), "manager cookie validates against the manager wrapper");
assert.ok(isValidKitchenCookie(kitchenCookie!), "kitchen cookie validates against the kitchen wrapper");
assert.equal(isValidKitchenCookie(managerCookie!), false, "a manager session must not validate as a kitchen session");
assert.equal(isValidManagerCookie(kitchenCookie!), false, "a kitchen session must not validate as a manager session");

console.log("staff-session.check.ts: all assertions passed");
