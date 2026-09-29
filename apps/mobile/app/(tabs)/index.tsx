import { StyleSheet, Text, View } from "react-native";
import {
  Card,
  EmptyState,
  Loading,
  Notice,
  PageHeader,
  Screen,
  StatusPill,
  uiStyles,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { dateTime, npr } from "@/lib/format";
import { colors, spacing } from "@/theme";

interface RecentPayment {
  transactionId: string;
  merchantName?: string;
  customerName?: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface CustomerDashboard {
  balance: number;
  walletStatus: string;
  todaySpending: number;
  monthlySpending: number;
  setup: {
    emailVerified: boolean;
    kycStatus: string;
    paymentPinConfigured: boolean;
    palmEnrolled: boolean;
    progress: number;
  };
  recent: RecentPayment[];
}

interface MerchantDashboard {
  merchant: { businessName: string; approvalStatus: string };
  metrics: { revenue: number; transactions: number; customers: number; refunds: number };
  recent: RecentPayment[];
}

function Metric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <Card style={[styles.metric, accent && styles.metricAccent]}>
      <Text style={[styles.metricLabel, accent && styles.metricAccentText]}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.metricAccentText]}>{value}</Text>
    </Card>
  );
}

function Recent({ items, customer }: { items: RecentPayment[]; customer: boolean }) {
  if (!items.length)
    return <EmptyState title="No payments yet" detail="Completed payments will appear here." />;
  return (
    <Card>
      <Text style={uiStyles.sectionTitle}>Recent payments</Text>
      {items.map((item) => (
        <View key={item.transactionId} style={styles.listRow}>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle} numberOfLines={1}>
              {customer ? item.merchantName ?? "Merchant" : item.customerName ?? "Customer"}
            </Text>
            <Text style={uiStyles.muted}>{dateTime(item.createdAt)}</Text>
          </View>
          <View style={styles.amountSide}>
            <Text style={styles.amount}>{npr(item.amount)}</Text>
            <StatusPill value={item.status} />
          </View>
        </View>
      ))}
    </Card>
  );
}

function CustomerHome() {
  const { user } = useAuth();
  const { data, error, loading } = useApiData(() =>
    api.request<CustomerDashboard>("/analytics/customer-dashboard"),
  );
  if (loading) return <Loading label="Loading your wallet…" />;
  if (error || !data) return <Screen><Notice>{error || "Dashboard unavailable."}</Notice></Screen>;
  return (
    <Screen>
      <PageHeader eyebrow="Namaste" title={`Welcome, ${user?.displayName.split(" ")[0]}`} detail="Your demo wallet and palm-payment activity." />
      <View style={styles.metricsGrid}>
        <Metric label="Wallet balance" value={npr(data.balance)} accent />
        <Metric label="Today" value={npr(data.todaySpending)} />
        <Metric label="This month" value={npr(data.monthlySpending)} />
        <Metric label="Setup" value={`${data.setup.progress}%`} />
      </View>
      <Card>
        <View style={uiStyles.rowBetween}>
          <View>
            <Text style={uiStyles.sectionTitle}>Palm readiness</Text>
            <Text style={uiStyles.muted}>Identity and approval remain server-controlled.</Text>
          </View>
          <StatusPill value={data.setup.palmEnrolled ? "ACTIVE" : "PENDING"} />
        </View>
        <Text style={uiStyles.muted}>KYC: {data.setup.kycStatus} · PIN: {data.setup.paymentPinConfigured ? "configured" : "required"}</Text>
      </Card>
      <Recent items={data.recent} customer />
    </Screen>
  );
}

function MerchantHome() {
  const { data, error, loading } = useApiData(() =>
    api.request<MerchantDashboard>("/merchants/dashboard"),
  );
  if (loading) return <Loading label="Loading merchant activity…" />;
  if (error || !data) return <Screen><Notice>{error || "Dashboard unavailable."}</Notice></Screen>;
  return (
    <Screen>
      <PageHeader eyebrow="Merchant console" title={data.merchant.businessName} detail="Live activity for your demo merchant wallet." />
      <StatusPill value={data.merchant.approvalStatus} />
      <View style={styles.metricsGrid}>
        <Metric label="Today's revenue" value={npr(data.metrics.revenue)} accent />
        <Metric label="Payments" value={data.metrics.transactions} />
        <Metric label="Customers" value={data.metrics.customers} />
        <Metric label="Refunds" value={data.metrics.refunds} />
      </View>
      <Recent items={data.recent} customer={false} />
    </Screen>
  );
}

export default function DashboardScreen() {
  const { user } = useAuth();
  if (user?.role === "CUSTOMER") return <CustomerHome />;
  if (user?.role === "MERCHANT") return <MerchantHome />;
  return (
    <Screen>
      <PageHeader eyebrow="Workspace" title={`Welcome, ${user?.displayName ?? "User"}`} detail="Use History, Alerts, and Profile to inspect your authorized account data." />
      <Card><Text style={uiStyles.sectionTitle}>Role</Text><StatusPill value={user?.role ?? "UNKNOWN"} /></Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metric: { width: "47%", minHeight: 118, justifyContent: "space-between" },
  metricAccent: { backgroundColor: colors.forest900, borderColor: colors.forest900 },
  metricLabel: { color: colors.slate500, fontSize: 12, fontWeight: "700" },
  metricValue: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  metricAccentText: { color: "white" },
  listRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.slate100, paddingTop: spacing.md, gap: spacing.md },
  listCopy: { flex: 1 },
  listTitle: { color: colors.ink, fontWeight: "800", marginBottom: 3 },
  amountSide: { alignItems: "flex-end", gap: 5 },
  amount: { color: colors.forest700, fontWeight: "900" },
});
