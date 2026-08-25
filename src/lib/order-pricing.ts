// Server-side pricing. The browser posts *what* was ordered — item ids,
// variant names, quantities — and never how much it costs. Prices are looked
// up from the menu here, so a hand-crafted request cannot buy a thali for ₹1.
// Pure; see order-pricing.check.ts.
import type { Menu, MenuItem, MenuVariant } from "../types/menu.ts";

export interface RequestedLine {
  itemId: string;
  variantName: string | null;
  qty: number;
}

/** Matches the order_items columns create_order() expects. */
export interface PricedLine {
  item_name: string;
  item_name_hi: string | null;
  variant_name: string | null;
  variant_name_hi: string | null;
  quantity: number;
  unit_price: number;
  is_veg: boolean;
}

export interface PricedCart {
  lines: PricedLine[];
  /** Rupees, for the order rows. */
  total: number;
  /** Paise, because that is the only unit Razorpay accepts. */
  totalPaise: number;
  /** Mean across distinct lines — what cartTotals() shows a table guest. */
  prepMinutes: number;
  /**
   * The slowest dish in the order. Scheduled orders cook backwards from a
   * promised time, so the mean would start a coffee-and-biryani order on the
   * coffee's clock and serve it late. Everything has to be ready at once.
   */
  prepMinutesMax: number;
}

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 50;

function findItem(menu: Menu, itemId: string): MenuItem | null {
  for (const cat of menu.categories) {
    const item = cat.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return null;
}

/** Either a fully priced cart or a reason it was rejected. Never throws — the
 *  caller turns the message into something the customer sees. */
export function priceCart(menu: Menu, requested: RequestedLine[]): { cart: PricedCart } | { error: string } {
  if (requested.length === 0) return { error: "Your order is empty." };
  if (requested.length > MAX_LINES) return { error: "That's too many different dishes for one order." };

  const lines: PricedLine[] = [];
  const seen = new Set<string>();

  for (const req of requested) {
    if (!Number.isInteger(req.qty) || req.qty < 1 || req.qty > MAX_QTY_PER_LINE) {
      return { error: "One of the quantities isn't valid." };
    }

    const item = findItem(menu, req.itemId);
    if (!item) return { error: "Something on your order is no longer on the menu." };

    // One line per item+variant, so a duplicated key can't sneak past the
    // quantity cap by splitting into many lines.
    const key = `${req.itemId}::${req.variantName ?? ""}`;
    if (seen.has(key)) return { error: "That order has a duplicated item." };
    seen.add(key);

    let variant: MenuVariant | null = null;
    if (item.variants?.length) {
      variant = item.variants.find((v) => v.name === req.variantName) ?? null;
      if (!variant) return { error: `Pick an option for ${item.name}.` };
    } else if (req.variantName) {
      return { error: `${item.name} doesn't have options.` };
    }

    const unitPrice = variant ? variant.price : item.price;
    const isVeg = variant ? variant.veg : item.veg;
    if (typeof unitPrice !== "number" || typeof isVeg !== "boolean") {
      return { error: "Something on your order is priced oddly — please call us." };
    }

    lines.push({
      item_name: item.name,
      item_name_hi: item.nameHi ?? null,
      variant_name: variant?.name ?? null,
      variant_name_hi: variant?.nameHi ?? null,
      quantity: req.qty,
      unit_price: unitPrice,
      is_veg: isVeg,
    });
  }

  const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  if (total <= 0) return { error: "That order comes to nothing." };

  // Counter items (water bottles) are dropped before any prep maths: they are
  // sold, not made. Because prepMinutes is a MEAN, including a 0-minute bottle
  // would halve the estimate on a real order — see cartTotals(), which
  // excludes them the same way so the two agree.
  const cooked = requested.map((r) => findItem(menu, r.itemId)).filter((i) => i && !i.counterItem);
  const preps = cooked.map((i) => i!.prepTimeMinutes);
  // An all-bottles order has nothing to cook and so no prep time at all.
  const prepMinutes = preps.length ? Math.round(preps.reduce((sum, p) => sum + p, 0) / preps.length) : 0;
  const prepMinutesMax = preps.length ? Math.max(...preps) : 0;

  return {
    cart: {
      lines,
      total,
      // Prices are whole rupees throughout this menu, but round rather than
      // truncate so a future ₹99.50 can't quietly lose a paisa.
      totalPaise: Math.round(total * 100),
      prepMinutes,
      prepMinutesMax,
    },
  };
}
