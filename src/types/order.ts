// Mirrors supabase/migrations/0001_orders.sql's enums/columns.
export type OrderStatus = "waiting_confirmation" | "confirmed" | "preparing" | "ready" | "served";
export type OrderSource = "table_1" | "table_2" | "table_3" | "table_4" | "swiggy" | "zomato" | "parcel";
export type PlacedBy = "customer" | "manager";

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

export interface OrderRow {
  id: string;
  source: OrderSource;
  placed_by: PlacedBy;
  status: OrderStatus;
  estimated_prep_minutes: number;
  created_at: string;
  confirmed_at: string | null;
  ready_at: string | null;
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
