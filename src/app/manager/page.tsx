import { cookies } from "next/headers";
import { MANAGER_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/manager-session";
import { ManagerPinGate } from "@/components/manager/ManagerPinGate";
import { ManagerDashboardPlaceholder } from "@/components/manager/ManagerDashboardPlaceholder";

export default async function ManagerPage() {
  const store = await cookies();
  const authed = isValidSessionCookieValue(store.get(MANAGER_SESSION_COOKIE)?.value);
  return authed ? <ManagerDashboardPlaceholder /> : <ManagerPinGate />;
}
