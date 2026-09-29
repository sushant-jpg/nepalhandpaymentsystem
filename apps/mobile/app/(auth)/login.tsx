import { Link, Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BrandMark, Button, Field, Notice, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors, spacing } from "@/theme";

export default function LoginScreen() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (user?.emailVerified) return <Redirect href="/(tabs)" />;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BrandMark />
      <View style={styles.intro}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.detail}>
          Sign in to your secure Nepal Hand Pay workspace.
        </Text>
      </View>
      {error && <Notice>{error}</Notice>}
      <View style={styles.form}>
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoComplete="current-password"
        />
        <Pressable onPress={() => setShowPassword((current) => !current)}>
          <Text style={styles.linkText}>
            {showPassword ? "Hide password" : "Show password"}
          </Text>
        </Pressable>
        <Button
          title={busy ? "Signing in…" : "Sign in"}
          disabled={busy || !email.trim() || !password}
          onPress={() => void submit()}
        />
      </View>
      <Text style={styles.footer}>
        New to Nepal Hand Pay?{" "}
        <Link href="/(auth)/register" style={styles.linkText}>
          Create an account
        </Link>
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: spacing.xl },
  title: { color: colors.ink, fontSize: 32, fontWeight: "900" },
  detail: { color: colors.slate500, fontSize: 15, lineHeight: 22, marginTop: 8 },
  form: { gap: spacing.lg, marginTop: spacing.lg },
  footer: { color: colors.slate500, textAlign: "center", marginTop: spacing.lg },
  linkText: { color: colors.forest600, fontWeight: "800" },
});
