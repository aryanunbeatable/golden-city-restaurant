import { createStaffSessionCookieValue, isValidStaffSessionCookieValue, STAFF_SESSION_TTL_MS } from "./staff-session.ts";

export const KITCHEN_SESSION_COOKIE = "gc_kitchen_session";
export const KITCHEN_SESSION_TTL_MS = STAFF_SESSION_TTL_MS;

export function createSessionCookieValue(): string | null {
  return createStaffSessionCookieValue(process.env.KITCHEN_SESSION_SECRET);
}

export function isValidSessionCookieValue(value: string | undefined): boolean {
  return isValidStaffSessionCookieValue(value, process.env.KITCHEN_SESSION_SECRET);
}
