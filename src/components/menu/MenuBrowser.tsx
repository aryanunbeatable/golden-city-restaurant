"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Menu, MenuItem, MenuVariant } from "@/types/menu";
import { cartTotals, decorateItem, lineKey, money, type CartLine } from "@/lib/cart";
import { ItemCard } from "./ItemCard";
import { ItemModal } from "./ItemModal";

export interface MenuBrowserProps {
  menu: Menu;
  density: "customer" | "manager";
  /** Cart is controlled — owned by the caller (via useCart()) so the page can
   *  drive its own checkout flow (customer cart sheet, manager kitchen-token
   *  panel) without a second, out-of-sync copy of the same state. */
  cart: CartLine[];
  onAddItem: (item: MenuItem, variant: MenuVariant | null, qty: number) => void;
  onBumpItem: (key: string, delta: number) => void;
  /** Tap handler for the customer floating cart bar. No-op if omitted. */
  onOpenCart?: () => void;
  className?: string;
}

const WIDE_QUERY = "(min-width: 768px)";

// useSyncExternalStore rather than an effect: matchMedia is exactly the
// external store it's for, and it avoids a setState-in-effect on first paint.
// The server snapshot assumes wide — the manager terminal is the common case,
// and a narrow client corrects itself on hydration.
function useIsWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

// Renders its own tabs (flex-none) above a scrolling item list (flex-1) —
// callers must give this a bounded-height ancestor (e.g. `flex-1 min-h-0`)
// or the internal overflow-y-auto has nothing to scroll against.
export function MenuBrowser({
  menu,
  density,
  cart,
  onAddItem,
  onBumpItem,
  onOpenCart,
  className = "",
}: MenuBrowserProps) {
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [activeCat, setActiveCat] = useState(menu.categories[0]?.id ?? "");

  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lockUntil = useRef(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => () => {
    if (rafId.current != null) cancelAnimationFrame(rafId.current);
  }, []);

  // The manager's category rail is a vertical sidebar only when there's width
  // for it; on a narrow screen it becomes a horizontal strip like the
  // customer's, so the scroll-sync has to follow the same axis.
  const isWide = useIsWide();
  const axis: "x" | "y" = density === "manager" && isWide ? "y" : "x";

  // Ported exactly from the design's syncBar(): after either a tap-jump or a
  // scroll-driven category change, keep the active tab visible in its bar.
  function syncBarToTab(id: string) {
    const bar = barRef.current;
    const btn = tabRefs.current[id];
    if (!bar || !btn) return;
    const b = bar.getBoundingClientRect();
    const t = btn.getBoundingClientRect();
    if (axis === "x") {
      if (t.left < b.left + 8) bar.scrollBy({ left: t.left - b.left - 14, behavior: "smooth" });
      else if (t.right > b.right - 8) bar.scrollBy({ left: t.right - b.right + 14, behavior: "smooth" });
    } else {
      if (t.top < b.top + 8) bar.scrollBy({ top: t.top - b.top - 14, behavior: "smooth" });
      else if (t.bottom > b.bottom - 8) bar.scrollBy({ top: t.bottom - b.bottom + 14, behavior: "smooth" });
    }
  }

  // Ported exactly from the design's jump(): tapping a tab locks scroll-sync
  // for 900ms so the smooth-scroll it triggers doesn't fight the scroll
  // handler over which tab should be active mid-animation.
  function jumpToCategory(id: string) {
    // eslint-disable-next-line react-hooks/purity -- event handler only (onClick), never called during render
    lockUntil.current = Date.now() + 900;
    setActiveCat(id);
    const el = sectionRefs.current[id];
    const sc = listRef.current;
    if (el && sc) sc.scrollTo({ top: el.offsetTop - 6, behavior: "smooth" });
    syncBarToTab(id);
  }

  // Ported exactly from the design's syncFromScroll(): the "line" a category
  // must cross to activate accounts for the tab bar's own height as an
  // offset (bar.bottom vs the list's top), then walks categories in order
  // and keeps the last one whose section has scrolled past that line.
  function syncFromScroll() {
    // eslint-disable-next-line react-hooks/purity -- event handler only (onScroll via rAF), never called during render
    if (Date.now() < lockUntil.current) return;
    const sc = listRef.current;
    if (!sc) return;
    const bar = barRef.current;
    const scTop = sc.getBoundingClientRect().top;
    const overlap = bar ? Math.max(0, bar.getBoundingClientRect().bottom - scTop) : 0;
    const line = scTop + overlap + 14;
    const cats = menu.categories;
    let pick = cats[0]?.id ?? "";
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) {
      pick = cats[cats.length - 1].id;
    } else {
      for (const c of cats) {
        const el = sectionRefs.current[c.id];
        if (!el) continue;
        if (el.getBoundingClientRect().top - line <= 1) pick = c.id;
        else break;
      }
    }
    if (pick && pick !== activeCat) {
      setActiveCat(pick);
      syncBarToTab(pick);
    }
  }

  function handleScroll() {
    if (rafId.current != null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      syncFromScroll();
    });
  }

  const qtyByLineKey = useMemo(() => new Map(cart.map((l) => [l.key, l.qty])), [cart]);
  const decoratedCategories = useMemo(
    () =>
      menu.categories.map((cat) => ({
        ...cat,
        items: cat.items.map((it) => decorateItem(it, qtyByLineKey)),
      })),
    [menu, qtyByLineKey],
  );
  const totals = cartTotals(cart);

  return (
    <div className={`flex min-h-0 ${density === "customer" ? "flex-col" : "flex-col md:flex-row"} ${className}`}>
      <div
        ref={barRef}
        className={
          density === "customer"
            ? "flex flex-none gap-[7px] overflow-x-auto border-b border-ink/[0.09] bg-background px-[18px] py-3 pb-[11px]"
            : "flex w-full flex-none gap-1.5 overflow-x-auto border-b border-ink/10 bg-surface p-2 md:w-[196px] md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0"
        }
      >
        {decoratedCategories.map((cat) => {
          const isActive = cat.id === activeCat;
          return (
            <button
              key={cat.id}
              ref={(el) => {
                tabRefs.current[cat.id] = el;
              }}
              onClick={() => jumpToCategory(cat.id)}
              className={
                density === "customer"
                  ? isActive
                    ? "flex-none whitespace-nowrap rounded-full bg-primary px-[13px] py-2 text-[11.5px] font-bold text-surface"
                    : "flex-none whitespace-nowrap rounded-full border border-ink/[0.14] bg-surface px-[13px] py-2 text-[11.5px] font-semibold text-ink transition hover:border-primary hover:text-primary"
                  : isActive
                    ? "flex flex-none items-center justify-between gap-1.5 whitespace-nowrap rounded-lg bg-primary/10 px-[11px] py-[10px] text-left text-xs font-extrabold text-primary md:w-full"
                    : "flex flex-none items-center justify-between gap-1.5 whitespace-nowrap rounded-lg px-[11px] py-[10px] text-left text-xs font-semibold text-ink transition hover:bg-ink/5 md:w-full"
              }
            >
              <span>{cat.name}</span>
              {density === "manager" && (
                <span className={isActive ? "text-[10px] opacity-70" : "text-[10px] text-muted"}>
                  {cat.items.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className={
          density === "customer"
            ? "relative min-h-0 flex-1 overflow-y-auto px-4 pb-[120px]"
            : // extra bottom room on mobile so the fixed token bar doesn't cover the last row
              "relative min-h-0 flex-1 overflow-y-auto p-3.5 pb-24 md:pb-3.5"
        }
      >
        {decoratedCategories.map((cat) => (
          <div
            key={cat.id}
            ref={(el) => {
              sectionRefs.current[cat.id] = el;
            }}
            className={density === "customer" ? "pt-5" : "pb-[18px]"}
          >
            {density === "customer" ? (
              <div className="flex items-baseline gap-[9px] px-0.5 pb-3">
                <span className="font-display text-[19px] text-primary">{cat.name}</span>
                <span className="h-px flex-1 bg-primary/[0.18]" />
                <span className="text-[10px] font-semibold text-muted">{cat.items.length} items</span>
              </div>
            ) : (
              <div className="font-display pb-3 text-xl text-primary">{cat.name}</div>
            )}
            <div
              className={
                density === "customer" ? "flex flex-col gap-[11px]" : "grid grid-cols-1 gap-2 sm:grid-cols-2"
              }
            >
              {cat.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  density={density}
                  onOpen={() => setActiveItem(item.raw)}
                  onAdd={() => (item.hasVariants ? setActiveItem(item.raw) : onAddItem(item.raw, null, 1))}
                  onInc={() => onAddItem(item.raw, null, 1)}
                  onDec={() => onBumpItem(lineKey(item.id), -1)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {density === "customer" && totals.count > 0 && (
        <button
          onClick={() => onOpenCart?.()}
          className="fixed right-4 bottom-[18px] left-4 z-40 flex items-center gap-3 rounded-2xl bg-primary px-[18px] py-[15px] text-surface shadow-[0_12px_28px_rgba(139,29,14,0.34)] transition hover:bg-[#7A180B]"
        >
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-secondary text-xs font-extrabold text-ink">
            {totals.count}
          </span>
          <span className="text-[13.5px] font-bold">View order</span>
          <span className="ml-auto text-sm font-extrabold">{money(totals.cost)}</span>
        </button>
      )}

      {activeItem && (
        <ItemModal
          key={activeItem.id}
          item={activeItem}
          density={density}
          onClose={() => setActiveItem(null)}
          onAdd={(variant, qty) => {
            onAddItem(activeItem, variant, qty);
            setActiveItem(null);
          }}
        />
      )}
    </div>
  );
}
