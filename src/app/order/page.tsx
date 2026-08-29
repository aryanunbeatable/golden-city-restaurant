import { connection } from "next/server";
import menuData from "@/data/menu.json";
import type { Menu } from "@/types/menu";
import { PhoneOrderFlow } from "@/components/customer/PhoneOrderFlow";
import { getLeastOrderedCategoryId, getPopularEntries } from "@/lib/popular-server";

// The permanent public link the manager shares on WhatsApp. Deliberately not
// linked from anywhere on the site — it is handed out, not discovered.
//
// connection() rather than letting this prerender: the ranking is read through
// the Supabase client, which Next has no way to see as dynamic, so a static
// build would bake whatever was popular at deploy time into the HTML and never
// update it. The other two menus are already dynamic (cookies / route params).
export default async function OrderPage() {
  await connection();
  const [popular, leastOrderedCategoryId] = await Promise.all([
    getPopularEntries(),
    getLeastOrderedCategoryId(),
  ]);
  return (
    <PhoneOrderFlow
      menu={menuData as Menu}
      popular={popular}
      leastOrderedCategoryId={leastOrderedCategoryId}
    />
  );
}
