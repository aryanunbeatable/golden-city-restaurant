import { createStaffSessionCookieValue, isValidStaffSessionCookieValue, STAFF_SESSION_TTL_MS } from "./staff-session.ts";

export const MANAGER_SESSION_COOKIE = "gc_manager_session";
export const MANAGER_SESSION_TTL_MS = STAFF_SESSION_TTL_MS;

export function createSessionCookieValue(): string | null {
  return createStaffSessionCookieValue(process.env.MANAGER_SESSION_SECRET);
}

export function isValidSessionCookieValue(value: string | undefined): boolean {
  return isValidStaffSessionCookieValue(value, process.env.MANAGER_SESSION_SECRET);
}
