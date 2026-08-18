// Mirrors supabase/migrations/0001_orders.sql + 0003_payments_history.sql.
export type OrderStatus =
  | "waiting_confirmation"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "cancelled";
export type OrderSource = "table_1" | "table_2" | "table_3" | "table_4" | "swiggy" | "zomato" | "parcel";
export type PlacedBy = "customer" | "manager";
export type PaymentMethod = "table_online" | "counter_online" | "counter_cash" | "swiggy" | "zomato";
export type PaymentStatus = "pending" | "paid";

// Display labels for the manager order-entry source picker.
export const ORDER_SOURCE_OPTIONS: readonly { value: OrderSource; label: string }[] = [
  { value: "table_1", label: "Table 1" },
  { value: "table_2", label: "Table 2" },
  { value: "table_3", label: "Table 3" },
  { value: "table_4", label: "Table 4" },
  { value: "swiggy", label: "Swiggy" },
  { value: "zomato", label: "Zomato" },
  { value: "parcel", label: "Parcel" },
];

export function isTableSource(source: OrderSource): boolean {
  return source.startsWith("table_");
}

// "Table 3" / "Swiggy" -> "TABLE 3" / "SWIGGY", for badge chips. Derived from
// ORDER_SOURCE_OPTIONS rather than reformatting the raw value, so the two
// never drift apart.
export function sourceLabel(source: OrderSource): string {
  const label = ORDER_SOURCE_OPTIONS.find((s) => s.value === source)?.label ?? source;
  return label.toUpperCase();
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  table_online: "Online · table",
  counter_online: "Online · counter",
  counter_cash: "Cash · counter",
  swiggy: "Swiggy",
  zomato: "Zomato",
};

// Aggregator orders are settled by the platform, never at the counter — the
// method follows from the source, so nobody is asked to pick it.
export function autoPaymentMethod(source: OrderSource): PaymentMethod | null {
  if (source === "swiggy") return "swiggy";
  if (source === "zomato") return "zomato";
  return null;
}

// What the manager can pick at counter entry. Anything unpaid stays null and
// is settled later from the orders list or history.
export const COUNTER_PAYMENT_OPTIONS: readonly { value: PaymentMethod; label: string }[] = [
  { value: "counter_cash", label: "Cash" },
  { value: "counter_online", label: "Online" },
];

export function paymentLabel(method: PaymentMethod | null, status: PaymentStatus): string {
  if (status === "pending" || !method) return "Pending";
  return PAYMENT_METHOD_LABELS[method];
}

export interface OrderRow {
  id: string;
  source: OrderSource;
  placed_by: PlacedBy;
  status: OrderStatus;
  estimated_prep_minutes: number;
  created_at: string;
  confirmed_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  item_name: string;
  item_name_hi: string | null;
  variant_name: string | null;
  variant_name_hi: string | null;
  quantity: number;
  unit_price: number;
  is_veg: boolean;
}

/** What `select("*, order_items(*)")` returns — the shape every board, list
 *  and history view works with. */
export interface OrderWithItems extends OrderRow {
  order_items: OrderItemRow[];
}
