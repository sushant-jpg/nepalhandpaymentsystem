import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BrandMark, Button, Field, Notice, Screen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors, spacing } from "@/theme";

export default function RegisterScreen() {
  const { register } = useAuth();
  const [role, setRole] = useState<"CUSTOMER" | "MERCHANT">("CUSTOMER");
  const [displayName, setDisplayName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const token = await register({
        role,
        displayName: displayName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        businessName: role === "MERCHANT" ? businessName.trim() : undefined,
        password,
      });
      router.replace({
        pathname: "/(auth)/verify-email",
        params: { email: email.trim(), ...(token ? { token } : {}) },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  const complete =
    displayName.trim().length >= 2 &&
    email.includes("@") &&
    password.length >= 10 &&
    (role === "CUSTOMER" || businessName.trim().length >= 2);

  return (
    <Screen>
      <BrandMark />
      <View style={styles.intro}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.detail}>Start with simulated NPR funds. No real money is processed.</Text>
      </View>
      {error && <Notice>{error}</Notice>}
      <View style={styles.roleRow}>
        {(["CUSTOMER", "MERCHANT"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setRole(value)}
            style={[styles.role, role === value && styles.roleActive]}
          >
            <Text style={[styles.roleText, role === value && styles.roleTextActive]}>
              {value === "CUSTOMER" ? "Customer" : "Merchant"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.form}>
        <Field label="Full name" value={displayName} onChangeText={setDisplayName} autoComplete="name" />
        {role === "MERCHANT" && (
          <Field label="Business name" value={businessName} onChangeText={setBusinessName} />
        )}
        <Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <Text style={styles.passwordHint}>At least 10 characters with uppercase, lowercase, and a number.</Text>
        <Button title={busy ? "Creating account…" : "Create account"} disabled={busy || !complete} onPress={() => void submit()} />
      </View>
      <Text style={styles.footer}>
        Already registered?{" "}
        <Link href="/(auth)/login" style={styles.linkText}>Sign in</Link>
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: spacing.lg },
  title: { color: colors.ink, fontSize: 29, fontWeight: "900" },
  detail: { color: colors.slate500, fontSize: 14, lineHeight: 21, marginTop: 7 },
  roleRow: { flexDirection: "row", gap: spacing.md },
  role: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.slate200, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  roleActive: { borderColor: colors.forest600, backgroundColor: colors.forest100 },
  roleText: { color: colors.slate500, fontWeight: "800" },
  roleTextActive: { color: colors.forest700 },
  form: { gap: spacing.md },
  passwordHint: { color: colors.slate500, fontSize: 12, marginTop: -4 },
  footer: { color: colors.slate500, textAlign: "center" },
  linkText: { color: colors.forest600, fontWeight: "800" },
});
