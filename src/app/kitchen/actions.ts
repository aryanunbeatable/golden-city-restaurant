"use server";

import { cookies } from "next/headers";
import {
  KITCHEN_SESSION_COOKIE,
  KITCHEN_SESSION_TTL_MS,
  createSessionCookieValue,
} from "@/lib/kitchen-session";

export async function verifyKitchenPin(pin: string): Promise<{ ok: boolean }> {
  const expected = process.env.KITCHEN_PIN;
  const value = expected ? createSessionCookieValue() : null;
  // Missing env config fails closed (nobody gets in) rather than open.
  if (!expected || !value || pin !== expected) return { ok: false };

  const store = await cookies();
  store.set(KITCHEN_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: KITCHEN_SESSION_TTL_MS / 1000,
    path: "/kitchen",
  });
  return { ok: true };
}

export async function signOutKitchen(): Promise<void> {
  const store = await cookies();
  store.delete({ name: KITCHEN_SESSION_COOKIE, path: "/kitchen" });
}
