"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOutManager } from "@/app/manager/actions";

// Order entry (source picker, item grid, kitchen-token panel, active
// orders) is its own build — this just proves the gate → dashboard →
// sign-out loop works end to end.
export function ManagerDashboardPlaceholder() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await signOutManager();
      router.refresh();
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="font-display text-2xl text-primary">Golden City Restaurant</span>
      <p className="text-sm text-muted">Manager dashboard — signed in. Order entry lands in the next step.</p>
      <button
        onClick={signOut}
        disabled={pending}
        className="rounded-xl border border-ink/[0.18] px-4 py-2.5 text-xs font-bold text-muted transition hover:border-primary hover:text-primary disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
