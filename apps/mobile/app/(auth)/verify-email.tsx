import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BrandMark, Button, Field, Notice, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { colors, spacing } from "@/theme";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ token?: string; email?: string }>();
  const { refreshUser } = useAuth();
  const [token, setToken] = useState(params.token ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function verify() {
    setBusy(true);
    setError("");
    try {
      await api.request("/auth/verify-email", {
        method: "POST",
        body: { token: token.trim() },
      });
      await refreshUser();
      router.replace("/(tabs)");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!params.email) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{
        message: string;
        developmentVerificationToken?: string;
      }>("/auth/resend-verification", {
        method: "POST",
        body: { email: params.email },
        authenticated: false,
      });
      if (result.developmentVerificationToken)
        setToken(result.developmentVerificationToken);
      setMessage(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resend verification.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BrandMark />
      <View style={styles.intro}>
        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.detail}>Use the token from your verification link. Development mode may fill it automatically.</Text>
      </View>
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="info">{message}</Notice>}
      <Field label="Verification token" value={token} onChangeText={setToken} autoCapitalize="none" />
      <Button title={busy ? "Verifying…" : "Verify email"} disabled={busy || token.trim().length < 20} onPress={() => void verify()} />
      <Button title="Resend instructions" tone="secondary" disabled={busy || !params.email} onPress={() => void resend()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: spacing.xl },
  title: { color: colors.ink, fontSize: 30, fontWeight: "900" },
  detail: { color: colors.slate500, fontSize: 14, lineHeight: 21, marginTop: 8 },
});
