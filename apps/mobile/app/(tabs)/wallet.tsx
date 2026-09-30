import { Text } from "react-native";
import { Card, Loading, Notice, PageHeader, Screen, StatusPill, uiStyles } from "@/components/ui";
import { useApiData } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { npr } from "@/lib/format";

interface Wallet { walletId: string; balance: number; currency: string; status: string }

export default function WalletScreen() {
  const { data, error, loading } = useApiData(() => api.request<Wallet>("/users/wallet"));
  if (loading) return <Loading label="Loading wallet..." />;
  return (
    <Screen>
      <PageHeader eyebrow="Mock wallet" title="Wallet" detail="Balances are stored and settled by the backend in integer paisa." />
      {error || !data ? <Notice>{error || "Wallet unavailable."}</Notice> : (
        <Card>
          <Text style={uiStyles.muted}>Available balance</Text>
          <Text style={uiStyles.metric}>{npr(data.balance)}</Text>
          <StatusPill value={data.status} />
          <Text style={uiStyles.muted}>Wallet ID: {data.walletId}</Text>
        </Card>
      )}
      <Notice tone="info">Send Money is a future capability. This demo currently authorizes QR and Palm merchant payments only.</Notice>
    </Screen>
  );
}
