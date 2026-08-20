import menuData from "@/data/menu.json";
import type { Menu } from "@/types/menu";
import { PhoneOrderFlow } from "@/components/customer/PhoneOrderFlow";

// The permanent public link the manager shares on WhatsApp. Deliberately not
// linked from anywhere on the site — it is handed out, not discovered.
export default function OrderPage() {
  return <PhoneOrderFlow menu={menuData as Menu} />;
}
