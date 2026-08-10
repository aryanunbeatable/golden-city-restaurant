import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { KITCHEN_SESSION_COOKIE, isValidSessionCookieValue } from "@/lib/kitchen-session";
import { KitchenPinGate } from "@/components/kitchen/KitchenPinGate";

export default async function KitchenPage() {
  const store = await cookies();
  const authed = isValidSessionCookieValue(store.get(KITCHEN_SESSION_COOKIE)?.value);
  if (authed) redirect("/kitchen/board");
  return <KitchenPinGate />;
}
