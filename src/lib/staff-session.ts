import { createHmac, timingSafeEqual } from "node:crypto";

// Shared engine behind manager-session.ts and kitchen-session.ts — both
// roles need an identical stateless, signed, self-expiring session cookie,
// just keyed by a different secret. Extracted here once a second role
// actually needed it, rather than copy-pasting the HMAC logic twice.
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // a shift

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// Token: "<expiryMs>.<hmac>". No session store — validity is just
// "signature matches" + "not expired yet", both checkable from the cookie
// value alone. Not a security-grade session (no auth-gated data yet —
// Supabase RLS is the real write boundary, gated separately by Supabase
// Auth), just enough to stop staff re-entering a PIN every page load during
// a shift, without anyone forging it from devtools.
export function createStaffSessionCookieValue(secret: string | undefined): string | null {
  if (!secret) return null; // unconfigured => no session can be minted (fail closed)
  const payload = String(Date.now() + STAFF_SESSION_TTL_MS);
  return `${payload}.${sign(payload, secret)}`;
}

export function isValidStaffSessionCookieValue(value: string | undefined, secret: string | undefined): boolean {
  if (!secret || !value) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return false;
  const expectedSig = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}
