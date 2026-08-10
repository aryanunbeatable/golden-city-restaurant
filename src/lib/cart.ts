// Cart line semantics, ported 1:1 from the design's shared store (lineFrom/add/bump/totals)
// so customer and manager order-entry compute identical totals from identical rules.
import { useCallback, useMemo, useState } from "react";
import type { MenuItem, MenuVariant } from "@/types/menu";

export interface CartLine {
  key: string;
  itemId: string;
  // name/variantName stay separate (not "Item (Variant)") because the cart
  // sheet renders them on two lines, matching the design's own lineFrom().
  name: string;
  variantName: string | null;
  nameHi: string;
  variantNameHi: string | null;
  price: number;
  veg: boolean;
  prepTimeMinutes: number;
  qty: number;
}

export function lineKey(itemId: string, variantName?: string | null): string {
  return variantName ? `${itemId}::${variantName}` : itemId;
}

// Hindi labels are snapshotted onto the line here, at add-time — same as the
// design — so a placed order keeps its kitchen-display text even if the
// menu's translations are edited later.
export function lineFromItem(item: MenuItem, variant: MenuVariant | null, qty: number): CartLine {
  return {
    key: lineKey(item.id, variant?.name),
    itemId: item.id,
    name: item.name,
    variantName: variant?.name ?? null,
    nameHi: item.nameHi,
    variantNameHi: variant?.nameHi ?? null,
    price: variant ? variant.price : item.price!,
    veg: variant ? variant.veg : !!item.veg,
    prepTimeMinutes: item.prepTimeMinutes,
    qty,
  };
}

export function lineLabel(line: CartLine): string {
  return line.variantName ? `${line.name} (${line.variantName})` : line.name;
}

export function addToCart(
  lines: CartLine[],
  item: MenuItem,
  variant: MenuVariant | null,
  qty: number,
): CartLine[] {
  const line = lineFromItem(item, variant, qty);
  const idx = lines.findIndex((l) => l.key === line.key);
  if (idx < 0) return [...lines, line];
  const next = lines.slice();
  next[idx] = { ...next[idx], qty: next[idx].qty + qty };
  return next;
}

// Filters out lines that drop to 0 or below, same as the design.
export function bumpCart(lines: CartLine[], key: string, delta: number): CartLine[] {
  return lines
    .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
    .filter((l) => l.qty > 0);
}

export function cartTotals(lines: CartLine[]) {
  const cost = lines.reduce((a, l) => a + l.price * l.qty, 0);
  // Mean of line prep times, matching the design exactly for this running
  // cart display. NOTE: mean understates the real wait for mixed orders —
  // flagged as worth switching to max() when order placement is wired up.
  const prepMinutes = lines.length
    ? Math.round(lines.reduce((a, l) => a + l.prepTimeMinutes, 0) / lines.length)
    : 0;
  const count = lines.reduce((a, l) => a + l.qty, 0);
  return { cost, prepMinutes, count };
}

export function money(n: number): string {
  return `₹${n}`;
}

// Owns cart state so it can be lifted above <MenuBrowser> — the page needs
// direct access to place an order, and (later) the manager screen needs its
// own independent cart, so this is a hook rather than state MenuBrowser owns.
export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const addItem = useCallback((item: MenuItem, variant: MenuVariant | null, qty: number) => {
    setLines((prev) => addToCart(prev, item, variant, qty));
  }, []);
  const bumpItem = useCallback((key: string, delta: number) => {
    setLines((prev) => bumpCart(prev, key, delta));
  }, []);
  const clear = useCallback(() => setLines([]), []);
  const totals = useMemo(() => cartTotals(lines), [lines]);
  return { lines, addItem, bumpItem, clear, totals };
}

export interface DecoratedItem {
  raw: MenuItem;
  id: string;
  name: string;
  description: string;
  hasDesc: boolean;
  priceLabel: string;
  prepLabel: string;
  isVeg: boolean;
  isNonVeg: boolean;
  hasVariants: boolean;
  variantHint: string;
  qty: number;
  hasQty: boolean;
  addLabel: string;
}

// Ports cats()'s per-item decoration exactly, including the two design
// quirks that are easy to get wrong: a variant item never shows a qty
// stepper in the list (hasQty is always false when variants exist — you
// always see "Choose"), and veg/non-veg marks are independent, not
// mutually exclusive, so a mixed-variant item (e.g. Manchow Soup, Veg +
// Non-Veg) shows both dots at once.
export function decorateItem(item: MenuItem, qtyByLineKey: Map<string, number>): DecoratedItem {
  const variants = item.variants ?? null;
  const prices = variants ? variants.map((v) => v.price) : [item.price!];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const qty = variants
    ? variants.reduce((sum, v) => sum + (qtyByLineKey.get(lineKey(item.id, v.name)) ?? 0), 0)
    : (qtyByLineKey.get(lineKey(item.id)) ?? 0);

  return {
    raw: item,
    id: item.id,
    name: item.name,
    description: item.description,
    hasDesc: !!item.description,
    priceLabel: min === max ? money(min) : `${money(min)}–${money(max)}`,
    prepLabel: `${item.prepTimeMinutes} min`,
    isVeg: variants ? variants.some((v) => v.veg) : !!item.veg,
    isNonVeg: variants ? variants.some((v) => !v.veg) : !item.veg,
    hasVariants: !!variants,
    variantHint: variants ? variants.map((v) => v.name).join(" / ") : "",
    qty,
    hasQty: qty > 0 && !variants,
    addLabel: variants ? "Choose" : qty > 0 ? `Add · ${qty}` : "Add",
  };
}
