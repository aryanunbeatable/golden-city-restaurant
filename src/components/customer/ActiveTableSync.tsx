"use client";

import { useEffect } from "react";
import { setActiveTable, type TableId } from "@/lib/table";

// Renders nothing — just mirrors the URL's table id into storage so later
// screens (menu, cart, tracking) can read "which table" without needing it
// threaded through their own route.
export function ActiveTableSync({ tableId }: { tableId: TableId }) {
  useEffect(() => {
    setActiveTable(tableId);
  }, [tableId]);
  return null;
}
