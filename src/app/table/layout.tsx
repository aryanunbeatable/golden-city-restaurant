import type { ReactNode } from "react";

/**
 * Every table's QR code opens here, and in practice that means a phone in a
 * guest's hand — but the screens underneath were still drawn at phone width
 * with nothing stopping them from stretching to a 1280px desktop tab if one
 * ever does open it (staff previewing a QR code, a screenshot on a laptop).
 * Same fix as /order: a centred column, not a redesign. Covers the tracker
 * at /table/[id]/order/[orderId] too, which is the same journey after the
 * order goes to the kitchen.
 *
 * ponytail: a plain div, deliberately. No transform, filter or containment
 * here — any of those would make this the containing block for the cart
 * sheet's `position: fixed` and pin it to this column instead of the viewport.
 */
export default function TableLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md">{children}</div>;
}
