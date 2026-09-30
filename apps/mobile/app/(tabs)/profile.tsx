import { router } from "expo-router";
import { Text, View } from "react-native";
import { Button, Card, Loading, Notice, PageHeader, Screen, StatusPill, uiStyles } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useApiData } from "@/hooks/useApiData";
import { api } from "@/lib/api";

interface Profile { email: string; displayName: string; phone?: string; role: string; status: string; emailVerified: boolean }

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { data, error, loading } = useApiData(() => api.request<Profile>("/users/profile"));
  if (loading) return <Loading label="Loading profile..." />;
  return (
    <Screen>
      <PageHeader eyebrow="Account" title={data?.displayName ?? user?.displayName ?? "Profile"} detail={data?.email ?? user?.email} />
      {error ? <Notice>{error}</Notice> : null}
      <Card>
        <View style={uiStyles.rowBetween}><Text style={uiStyles.sectionTitle}>Role</Text><StatusPill value={data?.role ?? user?.role ?? "UNKNOWN"} /></View>
        <View style={uiStyles.rowBetween}><Text style={uiStyles.muted}>Account status</Text><StatusPill value={data?.status ?? "ACTIVE"} /></View>
        <Text style={uiStyles.muted}>Email {data?.emailVerified ? "verified" : "not verified"}</Text>
      </Card>
      <Card>
        <Text style={uiStyles.sectionTitle}>Language / भाषा</Text>
        <Button title={language === "en" ? "नेपालीमा बदल्नुहोस्" : "Switch to English"} tone="secondary" onPress={() => void setLanguage(language === "en" ? "ne" : "en")} />
      </Card>
      <Button title="Wallet" tone="secondary" onPress={() => router.push("./wallet")} />
      {user?.role === "CUSTOMER" ? <Button title="Palm enrollment" tone="secondary" onPress={() => router.push("./palm")} /> : null}
      <Button title="Security" tone="secondary" onPress={() => router.push("./security")} />
      <Button title="Log out" tone="danger" onPress={() => void logout()} />
    </Screen>
  );
}
