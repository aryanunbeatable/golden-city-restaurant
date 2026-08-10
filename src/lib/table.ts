// The 4 fixed tables. No table management beyond this per the schema design.
export type TableId = 1 | 2 | 3 | 4;
export const TABLE_IDS: readonly TableId[] = [1, 2, 3, 4];

export function isTableId(value: string): boolean {
  return value === "1" || value === "2" || value === "3" || value === "4";
}

const STORAGE_KEY = "gc:table";

// No auth — this is just "which table is this browser currently ordering
// for", so the menu/cart/tracking screens (once built) don't need the id
// threaded through every route. /table/[id] is always what sets it.
export function setActiveTable(id: TableId) {
  localStorage.setItem(STORAGE_KEY, String(id));
}

export function getActiveTable(): TableId | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw && isTableId(raw) ? (Number(raw) as TableId) : null;
}
