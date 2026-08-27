import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MANAGER_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/manager-session";
import { ManagerNewOrderScreen } from "@/components/manager/ManagerNewOrderScreen";
import { getPopularEntries } from "@/lib/popular-server";
import menu from "@/data/menu.json";
import type { Menu } from "@/types/menu";

// Belt-and-suspenders: src/proxy.ts already redirects unauthenticated
// requests before this ever renders, but checking again here means this
// page stays safe even if reached by a path the proxy matcher doesn't cover.
export default async function NewOrderPage() {
  const store = await cookies();
  if (!isValidSessionCookieValue(store.get(MANAGER_SESSION_COOKIE)?.value)) {
    redirect("/manager");
  }
  return <ManagerNewOrderScreen menu={menu as Menu} popular={await getPopularEntries()} />;
}
