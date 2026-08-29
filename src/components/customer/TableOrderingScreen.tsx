"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Menu } from "@/types/menu";
import type { PopularEntry } from "@/lib/popular";
import type { TableId } from "@/lib/table";
import { useCart } from "@/lib/cart";
import { placeOrder } from "@/lib/orders";
import { MenuBrowser } from "@/components/menu/MenuBrowser";
import { CartSheet } from "@/components/menu/CartSheet";

export function TableOrderingScreen({
  tableId,
  menu,
  popular = [],
  leastOrderedCategoryId = null,
}: {
  tableId: TableId;
  menu: Menu;
  popular?: PopularEntry[];
  leastOrderedCategoryId?: string | null;
}) {
  const router = useRouter();
  const cart = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCooking() {
    setSubmitting(true);
    setError(null);
    try {
      const orderId = await placeOrder({
        source: `table_${tableId}`,
        placedBy: "customer",
        prepMinutes: cart.totals.prepMinutes,
        lines: cart.lines,
      });
      cart.clear();
      setCartOpen(false);
      router.push(`/table/${tableId}/order/${orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't place the order — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <MenuBrowser
        menu={menu}
        density="customer"
        className="min-h-0 flex-1"
        cart={cart.lines}
        onAddItem={cart.addItem}
        onBumpItem={cart.bumpItem}
        onOpenCart={() => setCartOpen(true)}
        popular={popular}
        leastOrderedCategoryId={leastOrderedCategoryId}
      />
      {cartOpen && (
        <CartSheet
          lines={cart.lines}
          totals={cart.totals}
          onInc={(key) => cart.bumpItem(key, 1)}
          onDec={(key) => cart.bumpItem(key, -1)}
          onClose={() => setCartOpen(false)}
          onStartCooking={startCooking}
          submitting={submitting}
          error={error}
        />
      )}
    </>
  );
}
