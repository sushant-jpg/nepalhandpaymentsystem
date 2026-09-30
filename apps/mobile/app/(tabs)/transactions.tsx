import { StyleSheet, Text, View } from "react-native";
import { Card, EmptyState, Loading, Notice, PageHeader, Screen, StatusPill, uiStyles } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { dateTime, npr } from "@/lib/format";
import { colors, spacing } from "@/theme";

interface TransactionItem {
  transactionId: string;
  customerName?: string;
  merchantName?: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string;
  createdAt: string;
}

export default function TransactionsScreen() {
  const { user } = useAuth();
  const { data, error, loading } = useApiData(() =>
    api.request<{ items: TransactionItem[] }>("/transactions?limit=50"),
  );
  if (loading) return <Loading label="Loading transactions..." />;
  return (
    <Screen>
      <PageHeader eyebrow="Account activity" title="Transactions" detail="Server-authoritative payment history for this account." />
      {error ? <Notice>{error}</Notice> : !data?.items.length ? (
        <EmptyState title="No transactions" detail="Completed and failed payments will appear here." />
      ) : data.items.map((item) => (
        <Card key={item.transactionId}>
          <View style={uiStyles.rowBetween}>
            <View style={styles.copy}>
              <Text style={styles.title}>{user?.role === "CUSTOMER" ? item.merchantName ?? "Merchant" : item.customerName ?? "Customer"}</Text>
              <Text style={uiStyles.muted}>{item.paymentMethod} Pay · {dateTime(item.createdAt)}</Text>
              <Text style={styles.reference}>{item.transactionId}</Text>
            </View>
            <View style={styles.side}>
              <Text style={styles.amount}>{npr(item.amount)}</Text>
              <StatusPill value={item.status} />
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, gap: 4 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  reference: { color: colors.slate500, fontSize: 11 },
  side: { alignItems: "flex-end", gap: spacing.sm },
  amount: { color: colors.forest700, fontSize: 16, fontWeight: "900" },
});
