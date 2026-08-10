import { notFound } from "next/navigation";
import { isTableId, type TableId } from "@/lib/table";
import { OrderTracker } from "@/components/customer/OrderTracker";

export default async function OrderTrackingPage({ params }: PageProps<"/table/[id]/order/[orderId]">) {
  const { id, orderId } = await params;
  if (!isTableId(id)) notFound();
  const tableId = Number(id) as TableId;

  return <OrderTracker tableId={tableId} orderId={orderId} />;
}
