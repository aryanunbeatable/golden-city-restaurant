import { ManagerHistory } from "@/components/manager/ManagerHistory";

// Auth is enforced by src/proxy.ts for every /manager/* path.
export default function ManagerHistoryPage() {
  return <ManagerHistory />;
}
