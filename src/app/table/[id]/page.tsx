import Link from "next/link";
import { notFound } from "next/navigation";
import { isTableId, type TableId } from "@/lib/table";
import { ActiveTableSync } from "@/components/customer/ActiveTableSync";
import { TableOrderingScreen } from "@/components/customer/TableOrderingScreen";
import { getPopularEntries } from "@/lib/popular-server";
import menu from "@/data/menu.json";
import type { Menu } from "@/types/menu";

// The QR code on each physical table points straight here — no selector
// grid in between. Invalid/typo'd ids (there are only 4 tables) 404.
export default async function TablePage({ params }: PageProps<"/table/[id]">) {
  const { id } = await params;
  if (!isTableId(id)) notFound();
  const tableId = Number(id) as TableId;

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <ActiveTableSync tableId={tableId} />
      <div className="flex flex-none items-center gap-2.5 px-[18px] pt-1.5">
        <Link href="/" className="rounded-md px-1.5 py-1 text-xl font-bold text-primary">
          ‹
        </Link>
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-base text-primary">Golden City Restaurant</span>
          <span className="text-[10px] font-semibold tracking-[.06em] text-muted">
            TABLE {tableId} · DINE-IN
          </span>
        </div>
      </div>
      <TableOrderingScreen tableId={tableId} menu={menu as Menu} popular={await getPopularEntries()} />
    </main>
  );
}
