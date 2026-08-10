import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { KITCHEN_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/kitchen-session";
import { KitchenBoard } from "@/components/kitchen/KitchenBoard";

// Belt-and-suspenders, same as the manager sub-routes: src/proxy.ts already
// redirects unauthenticated requests before this renders.
export default async function KitchenBoardPage() {
  const store = await cookies();
  if (!isValidSessionCookieValue(store.get(KITCHEN_SESSION_COOKIE)?.value)) {
    redirect("/kitchen");
  }
  return <KitchenBoard />;
}
