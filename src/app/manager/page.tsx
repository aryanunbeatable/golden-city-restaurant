import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MANAGER_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/manager-session";
import { ManagerPinGate } from "@/components/manager/ManagerPinGate";

export default async function ManagerPage() {
  const store = await cookies();
  const authed = isValidSessionCookieValue(store.get(MANAGER_SESSION_COOKIE)?.value);
  if (authed) redirect("/manager/new-order");
  return <ManagerPinGate />;
}
