import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { MANAGER_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/manager-session";
import { ManagerOrdersList } from "@/components/manager/ManagerOrdersList";
import { reconcileStuckPayments } from "@/lib/reconcile-payments";

// Belt-and-suspenders, same as /manager/new-order: src/proxy.ts already
// redirects unauthenticated requests before this renders.
export default async function ManagerOrdersPage() {
  const store = await cookies();
  if (!isValidSessionCookieValue(store.get(MANAGER_SESSION_COOKIE)?.value)) {
    redirect("/manager");
  }

  // Money can arrive without us hearing about it; opening the board is when
  // someone is here to act on it. after() so a slow or unreachable Razorpay
  // can never hold up the one screen that has to open during service —
  // anything it recovers reaches the list over Realtime a moment later.
  after(reconcileStuckPayments);

  return <ManagerOrdersList />;
}
