import Image from "next/image";
import type { DecoratedItem } from "@/lib/cart";

// No dish photos exist yet (menu.json: every item is "photo": "placeholder") —
// this diagonal stripe is the design's stand-in, at two sizes (list card / modal).
export const PHOTO_PLACEHOLDER_SM =
  "repeating-linear-gradient(45deg, #F5EAD4, #F5EAD4 5px, #EFE0C0 5px, #EFE0C0 10px)";
export const PHOTO_PLACEHOLDER_LG =
  "repeating-linear-gradient(45deg, #F5EAD4, #F5EAD4 7px, #EFE0C0 7px, #EFE0C0 14px)";

export function VegDot({ veg, size = 12 }: { veg: boolean; size?: number }) {
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-[3px] border-[1.5px] ${veg ? "border-veg" : "border-non-veg"}`}
      style={{ width: size, height: size }}
    >
      <span
        className={`rounded-full ${veg ? "bg-veg" : "bg-non-veg"}`}
        style={{ width: size * 0.42, height: size * 0.42 }}
      />
    </span>
  );
}

interface ItemCardProps {
  item: DecoratedItem;
  density: "customer" | "manager";
  onOpen: () => void;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
}

export function ItemCard({ item, density, onOpen, onAdd, onInc, onDec }: ItemCardProps) {
  const stepper = (
    <div
      className={
        density === "customer"
          ? "flex items-center gap-0.5 overflow-hidden rounded-[9px] border border-primary"
          : "flex items-center gap-px overflow-hidden rounded-lg border border-primary"
      }
    >
      <button
        onClick={onDec}
        className={
          density === "customer"
            ? "flex h-7 w-7 items-center justify-center text-[15px] font-bold text-primary"
            : "flex h-[26px] w-6 items-center justify-center text-sm font-bold text-primary"
        }
      >
        −
      </button>
      <span
        className={
          density === "customer"
            ? "min-w-5 text-center text-xs font-extrabold text-primary"
            : "min-w-4 text-center text-[11.5px] font-extrabold text-primary"
        }
      >
        {item.qty}
      </span>
      <button
        onClick={onInc}
        className={
          density === "customer"
            ? "flex h-7 w-7 items-center justify-center text-[15px] font-bold text-primary"
            : "flex h-[26px] w-6 items-center justify-center text-sm font-bold text-primary"
        }
      >
        +
      </button>
    </div>
  );

  const addButton = (
    <button
      onClick={onAdd}
      className={
        density === "customer"
          ? "rounded-[9px] border border-primary bg-surface px-3.5 py-2 text-[11.5px] font-bold text-primary transition hover:bg-primary hover:text-surface"
          : "rounded-lg border border-primary/45 px-[11px] py-[7px] text-[11px] font-bold text-primary transition hover:bg-primary hover:text-surface"
      }
    >
      {item.addLabel}
    </button>
  );

  if (density === "manager") {
    return (
      <div className="flex items-center gap-[9px] rounded-[10px] border border-ink/[0.09] bg-surface px-[11px] py-[9px]">
        {item.isVeg && <VegDot veg />}
        {item.isNonVeg && <VegDot veg={false} />}
        <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="truncate text-[12.5px] font-bold text-ink">{item.name}</span>
          <span className="text-[10.5px] font-semibold text-muted">
            {item.priceLabel} · {item.prepLabel}
          </span>
        </button>
        {item.hasQty ? stepper : addButton}
      </div>
    );
  }

  const hasPhoto = item.raw.photo && item.raw.photo !== "placeholder";

  return (
    <div className="flex gap-3 rounded-2xl border border-ink/[0.09] bg-surface p-3 shadow-[0_1px_3px_rgba(42,27,18,0.05)]">
      <button
        onClick={onOpen}
        className="relative flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-xl border border-ink/[0.08]"
        style={hasPhoto ? undefined : { backgroundImage: PHOTO_PLACEHOLDER_SM }}
      >
        {hasPhoto ? (
          <Image src={item.raw.photo} alt={item.name} fill sizes="80px" className="object-cover" />
        ) : (
          <span className="text-center font-mono text-[7px] leading-[1.4] tracking-[.04em] text-muted">
            PHOTO
            <br />
            COMING
            <br />
            SOON
          </span>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <div className="flex items-center gap-1.5">
          {item.isVeg && <VegDot veg />}
          {item.isNonVeg && <VegDot veg={false} />}
          <button
            onClick={onOpen}
            className="text-left text-[13.5px] font-bold text-ink transition hover:text-primary"
          >
            {item.name}
          </button>
        </div>
        {item.hasDesc && (
          <span className="text-pretty text-[11px] leading-[1.45] text-muted">{item.description}</span>
        )}
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-sm font-extrabold text-ink">{item.priceLabel}</span>
          <span className="rounded-full border border-secondary/40 bg-secondary/[0.16] px-[7px] py-1 text-[9.5px] font-semibold text-[#8B6C08]">
            {item.prepLabel}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {item.hasQty ? stepper : addButton}
          {item.hasVariants && <span className="text-[10px] font-medium text-muted">{item.variantHint}</span>}
        </div>
      </div>
    </div>
  );
}
