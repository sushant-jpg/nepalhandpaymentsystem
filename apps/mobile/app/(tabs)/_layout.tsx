import { Redirect, Tabs } from "expo-router";
import { Text } from "react-native";
import { Loading } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/theme";

function TabIcon({ symbol, color }: { symbol: string; color: string }) {
  return <Text style={{ color, fontSize: 18 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Loading workspace…" />;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (!user.emailVerified)
    return <Redirect href="/(auth)/verify-email" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.forest600,
        tabBarInactiveTintColor: colors.slate500,
        tabBarStyle: {
          height: 68,
          paddingTop: 7,
          paddingBottom: 8,
          borderTopColor: colors.slate200,
          backgroundColor: colors.surface,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="palm-pay"
        options={{
          title: "Palm Pay",
          href: user.role === "MERCHANT" ? "/(tabs)/palm-pay" : null,
          tabBarIcon: ({ color }) => <TabIcon symbol="✋" color={color} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: "History",
          tabBarIcon: ({ color }) => <TabIcon symbol="↕" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color }) => <TabIcon symbol="●" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} />,
        }}
      />
    </Tabs>
  );
}
