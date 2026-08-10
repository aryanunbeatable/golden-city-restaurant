import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MANAGER_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/manager-session";
import { ManagerOrdersList } from "@/components/manager/ManagerOrdersList";

// Belt-and-suspenders, same as /manager/new-order: src/proxy.ts already
// redirects unauthenticated requests before this renders.
export default async function ManagerOrdersPage() {
  const store = await cookies();
  if (!isValidSessionCookieValue(store.get(MANAGER_SESSION_COOKIE)?.value)) {
    redirect("/manager");
  }
  return <ManagerOrdersList />;
}
