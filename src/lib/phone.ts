// Indian mobile numbers, normalised to E.164 so the same person always keys to
// the same string — the OTP table, the remember-me cookie and the order row all
// depend on that. Pure; see phone.check.ts.

/** Returns "+91XXXXXXXXXX", or null if it isn't a valid Indian mobile. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  // Indian mobiles are 10 digits and always start 6-9.
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

/** "+919876543210" -> "98765 43210", for showing it back to the customer. */
export function formatPhone(e164: string): string {
  const local = e164.replace(/^\+91/, "");
  return local.length === 10 ? `${local.slice(0, 5)} ${local.slice(5)}` : e164;
}

/** Names go on the kitchen card, so keep them short and free of newlines. */
export function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) return null;
  return name;
}
