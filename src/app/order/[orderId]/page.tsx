import { PhoneOrderTracker } from "@/components/customer/PhoneOrderTracker";

export default async function PhoneOrderPage({ params }: PageProps<"/order/[orderId]">) {
  const { orderId } = await params;
  return <PhoneOrderTracker orderId={orderId} />;
}
