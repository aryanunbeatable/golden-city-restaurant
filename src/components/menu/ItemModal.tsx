"use client";

import { useState } from "react";
import Image from "next/image";
import type { MenuItem, MenuVariant } from "@/types/menu";
import { money } from "@/lib/cart";
import { PHOTO_PLACEHOLDER_LG, VegDot } from "./ItemCard";

interface ItemModalProps {
  item: MenuItem;
  density: "customer" | "manager";
  onClose: () => void;
  onAdd: (variant: MenuVariant | null, qty: number) => void;
}

// Mount with `key={item.id}` from the caller so variant/qty selection resets
// per item, the same way the design's openItem() resets mdVar/mdQty.
export function ItemModal({ item, density, onClose, onAdd }: ItemModalProps) {
  const [variantIndex, setVariantIndex] = useState(0);
  const [qty, setQty] = useState(1);

  const variant = item.variants ? item.variants[variantIndex] : null;
  const unitPrice = variant ? variant.price : item.price!;
  const isVeg = item.variants ? item.variants.some((v) => v.veg) : !!item.veg;
  const isNonVeg = item.variants ? item.variants.some((v) => !v.veg) : !item.veg;

  const hasPhoto = item.photo && item.photo !== "placeholder";

  const content = (
    <>
      <div
        // aspect-square, not the old fixed h-28: photos are shot 1:1, and a
        // fixed short height on a full-width box made object-cover crop the
        // top and bottom off every dish (h-28 on a ~340px sheet is a ~3:1
        // banner, not a square).
        className="relative aspect-square flex-none overflow-hidden rounded-2xl border border-ink/[0.08]"
        style={hasPhoto ? undefined : { backgroundImage: PHOTO_PLACEHOLDER_LG }}
      >
        {hasPhoto ? (
          <Image src={item.photo} alt={item.name} fill sizes="(min-width: 768px) 420px, 100vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-center font-mono text-[11px] leading-[1.5] tracking-[.06em] text-muted">
            DISH PHOTO
            <br />
            COMING SOON
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isVeg && <VegDot veg size={14} />}
        {isNonVeg && <VegDot veg={false} size={14} />}
        <span className="text-lg font-extrabold text-ink">{item.name}</span>
      </div>

      {item.description && (
        <span className="text-pretty text-[12.5px] leading-[1.6] text-muted">{item.description}</span>
      )}

      <span className="self-start rounded-full border border-secondary/40 bg-secondary/[0.16] px-2.5 py-1.5 text-[11px] font-semibold text-[#8B6C08]">
        Prep {item.prepTimeMinutes} min
      </span>

      {item.variants && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold tracking-[.04em] text-muted">CHOOSE AN OPTION</span>
          {item.variants.map((v, i) => {
            const selected = i === variantIndex;
            return (
              <button
                key={v.name}
                onClick={() => setVariantIndex(i)}
                className={
                  selected
                    ? "flex w-full items-center gap-[9px] rounded-xl border-[1.5px] border-primary bg-primary/[0.07] px-3.5 py-3 text-left"
                    : "flex w-full items-center gap-[9px] rounded-xl border border-ink/[0.14] bg-surface px-3.5 py-3 text-left transition hover:border-primary"
                }
              >
                <span
                  className={
                    selected
                      ? "h-4 w-4 flex-none rounded-full border-[5px] border-primary bg-background"
                      : "h-4 w-4 flex-none rounded-full border border-ink/30"
                  }
                />
                <span className={`flex-1 text-[13px] ${selected ? "font-bold" : "font-semibold"} text-ink`}>
                  {v.name}
                </span>
                <span className={`text-[13px] font-extrabold ${selected ? "text-primary" : "text-muted"}`}>
                  {money(v.price)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex flex-none items-center gap-1 rounded-xl border border-ink/[0.18] p-1">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="flex h-[34px] w-[34px] items-center justify-center text-lg font-bold text-primary"
          >
            −
          </button>
          <span className="min-w-[26px] text-center text-[15px] font-extrabold text-ink">{qty}</span>
          <button
            onClick={() => setQty((q) => q + 1)}
            className="flex h-[34px] w-[34px] items-center justify-center text-lg font-bold text-primary"
          >
            +
          </button>
        </div>
        {density === "manager" && (
          <button
            onClick={onClose}
            className="flex-none rounded-[10px] border border-ink/[0.18] px-4 py-[13px] text-[12.5px] font-bold text-muted"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => onAdd(variant, qty)}
          className="flex-1 rounded-xl bg-primary py-[15px] text-[14px] font-extrabold text-surface shadow-[0_10px_24px_rgba(139,29,14,0.3)] transition hover:bg-[#7A180B]"
        >
          {density === "manager" ? "Add" : "Add to order"} · {money(unitPrice * qty)}
        </button>
      </div>
    </>
  );

  if (density === "customer") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-ink/45">
        <div onClick={onClose} className="flex-1 cursor-pointer" />
        {/* Centred and capped, same reasoning and value as CartSheet: the
            sheet is `fixed`, so it escapes the order flow's centred column
            and would otherwise span a whole desktop screen — square photo
            included, which is what made this visible. No-op below 448px,
            which is every phone. */}
        <div className="animate-gc-sheet mx-auto flex max-h-[86%] w-full max-w-md flex-col gap-3.5 overflow-y-auto rounded-t-[26px] rounded-b-[34px] bg-background p-4 pb-5">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
      <div className="animate-gc-pop flex w-[420px] flex-col gap-3.5 rounded-2xl bg-background p-5">
        {content}
      </div>
    </div>
  );
}
