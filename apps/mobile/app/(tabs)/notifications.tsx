import { StyleSheet, Text, View } from "react-native";
import { Button, Card, EmptyState, Loading, Notice, PageHeader, Screen, uiStyles } from "@/components/ui";
import { useApiData } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { colors } from "@/theme";

interface NotificationItem {
  _id: string;
  title: string;
  message: string;
  severity: string;
  readAt?: string;
  createdAt: string;
}

export default function NotificationsScreen() {
  const { data, error, loading, reload } = useApiData(() =>
    api.request<{ items: NotificationItem[]; unreadCount: number }>("/users/notifications?limit=50"),
  );
  async function readAll() {
    await api.request("/users/notifications/read-all", { method: "POST" });
    await reload();
  }
  if (loading) return <Loading label="Loading notifications..." />;
  return (
    <Screen>
      <PageHeader eyebrow="Account alerts" title="Notifications" detail={`${data?.unreadCount ?? 0} unread`} />
      {data?.unreadCount ? <Button title="Mark all as read" tone="secondary" onPress={() => void readAll()} /> : null}
      {error ? <Notice>{error}</Notice> : !data?.items.length ? (
        <EmptyState title="No notifications" detail="Security and payment updates will appear here." />
      ) : data.items.map((item) => (
        <Card key={item._id} style={!item.readAt ? styles.unread : undefined}>
          <View style={uiStyles.rowBetween}>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.severity}>{item.severity}</Text>
          </View>
          <Text style={uiStyles.muted}>{item.message}</Text>
          <Text style={styles.date}>{dateTime(item.createdAt)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  unread: { borderColor: colors.forest600, borderWidth: 2 },
  title: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: "800" },
  severity: { color: colors.slate500, fontSize: 10, fontWeight: "900" },
  date: { color: colors.slate500, fontSize: 11 },
});
