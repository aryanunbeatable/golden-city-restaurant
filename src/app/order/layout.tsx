import type { ReactNode } from "react";

/**
 * The WhatsApp link gets opened on desktops as often as phones, and every
 * screen underneath it was drawn at phone width. Left unconstrained they
 * stretch to 1280px — inputs a metre wide, two words of body copy per line.
 *
 * A centred column is the whole fix: the screens keep the proportions they
 * were designed at, and the body's ivory fills the rest. Covers the tracker
 * at /order/[orderId] too, which is the same journey after payment.
 *
 * ponytail: a plain div, deliberately. No transform, filter or containment
 * here — any of those would make this the containing block for the cart
 * sheet's `position: fixed` and pin it to this column instead of the viewport.
 */
export default function OrderLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md">{children}</div>;
}
