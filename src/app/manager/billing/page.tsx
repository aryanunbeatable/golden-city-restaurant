import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MANAGER_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/manager-session";
import { ManagerBillingScreen } from "@/components/manager/ManagerBillingScreen";

// Belt-and-suspenders, same as the other manager sub-routes: src/proxy.ts
// already redirects unauthenticated requests before this renders.
export default async function ManagerBillingPage() {
  const store = await cookies();
  if (!isValidSessionCookieValue(store.get(MANAGER_SESSION_COOKIE)?.value)) {
    redirect("/manager");
  }
  return <ManagerBillingScreen />;
}
