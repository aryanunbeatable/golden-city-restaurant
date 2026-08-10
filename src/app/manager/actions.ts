"use server";

import { cookies } from "next/headers";
import {
  MANAGER_SESSION_COOKIE,
  MANAGER_SESSION_TTL_MS,
  createSessionCookieValue,
} from "@/lib/manager-session";

export async function verifyManagerPin(pin: string): Promise<{ ok: boolean }> {
  const expected = process.env.MANAGER_PIN;
  const value = expected ? createSessionCookieValue() : null;
  // Missing env config fails closed (nobody gets in) rather than open.
  if (!expected || !value || pin !== expected) return { ok: false };

  const store = await cookies();
  store.set(MANAGER_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MANAGER_SESSION_TTL_MS / 1000,
    path: "/manager",
  });
  return { ok: true };
}

export async function signOutManager(): Promise<void> {
  const store = await cookies();
  store.delete({ name: MANAGER_SESSION_COOKIE, path: "/manager" });
}
