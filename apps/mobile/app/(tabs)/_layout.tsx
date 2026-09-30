import { Redirect, Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { Loading } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/theme";

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
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
        name="qr-pay"
        options={{
          title: "QR Pay",
          href: user.role === "CUSTOMER" ? "./qr-pay" : null,
          tabBarIcon: ({ color }) => <TabIcon symbol="QR" color={color} />,
        }}
      />
      <Tabs.Screen
        name="generate-qr"
        options={{
          title: "Generate",
          href: user.role === "MERCHANT" ? "./generate-qr" : null,
          tabBarIcon: ({ color }) => <TabIcon symbol="QR" color={color} />,
        }}
      />
      <Tabs.Screen
        name="palm-pay"
        options={{
          title: "Palm Pay",
          href: user.role === "MERCHANT" ? "./palm-pay" : null,
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
      <Tabs.Screen name="wallet" options={{ href: null }} />
      <Tabs.Screen name="palm" options={{ href: null }} />
      <Tabs.Screen name="security" options={{ href: null }} />
    </Tabs>
  );
}
