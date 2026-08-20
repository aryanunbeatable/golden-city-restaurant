"use client";

import { useState, useSyncExternalStore } from "react";
import { savePushSubscription } from "@/app/order/push-actions";

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  // Backed by a real ArrayBuffer, not ArrayBufferLike: applicationServerKey is
  // typed as BufferSource, which excludes a possibly-SharedArrayBuffer view.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type State = "idle" | "asking" | "on" | "denied" | "failed";

/**
 * Whether this browser can be asked at all, read through
 * useSyncExternalStore rather than during render.
 *
 * The value only exists on the client, so reading it directly would render
 * nothing on the server and a button on the client — a hydration mismatch.
 * The server snapshot says "unsupported" and the real answer arrives after
 * hydration, which is the same shape as useIsWide() in MenuBrowser.
 */
const NEVER_CHANGES = () => () => {};

function readSupport(): "unsupported" | "denied" | "available" {
  if (!("PushManager" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (typeof Notification === "undefined") return "unsupported";
  // A denial is sticky — the browser will not prompt again, so there is
  // nothing useful to render.
  return Notification.permission === "denied" ? "denied" : "available";
}

function usePushSupport() {
  return useSyncExternalStore(NEVER_CHANGES, readSupport, () => "unsupported" as const);
}

/**
 * "Ping me when it's ready."
 *
 * Behind a button on purpose. An unprompted permission dialog on page load is
 * the reliable way to get denied, and a denial is sticky — the browser will
 * not ask again, so there is no second chance at it.
 *
 * Renders nothing at all where push is unsupported. That is most iPhones:
 * Safari only exposes PushManager to sites added to the Home Screen, which
 * nobody does from a WhatsApp link. Those customers keep the live tracker,
 * which is why the countdowns had to work on their own first.
 */
export function PushOptIn({ orderId }: { orderId: string }) {
  const support = usePushSupport();
  const [state, setState] = useState<State>("idle");

  if (support !== "available" || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return null;
  if (state === "denied") return null; // asking again is not possible

  async function enable() {
    setState("asking");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "idle");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toBytes(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      const result = await savePushSubscription(orderId, subscription.toJSON());
      setState(result.ok ? "on" : "failed");
    } catch {
      setState("failed");
    }
  }

  if (state === "on") {
    return (
      <div className="animate-gc-pop-confirm flex items-center justify-center gap-2 rounded-2xl border border-veg/35 bg-veg/[0.09] px-3.5 py-2.5">
        <span className="text-sm">🔔</span>
        <span className="text-[11.5px] font-semibold text-veg">
          We&apos;ll buzz your phone when it&apos;s time to leave.
        </span>
      </div>
    );
  }

  return (
    <button
      onClick={enable}
      disabled={state === "asking"}
      className="flex items-center justify-center gap-2 rounded-2xl border border-ink/[0.16] bg-surface px-3.5 py-3 transition hover:border-primary disabled:opacity-60"
    >
      <span className="text-sm">🔔</span>
      <span className="text-[12px] font-bold text-ink">
        {state === "asking"
          ? "Just a second…"
          : state === "failed"
            ? "Couldn't turn that on — tap to retry"
            : "Ping me when it's ready"}
      </span>
    </button>
  );
}
