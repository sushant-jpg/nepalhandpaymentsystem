import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

export function Screen({
  children,
  scroll = true,
}: PropsWithChildren<{ scroll?: boolean }>) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.screenContent}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandIcon}>
        <Text style={styles.brandHand}>✋</Text>
      </View>
      {!compact && (
        <View>
          <Text style={styles.brandName}>NEPAL HAND PAY</Text>
          <Text style={styles.brandTag}>Secure demo wallet</Text>
        </View>
      )}
    </View>
  );
}

export function PageHeader({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text style={styles.title}>{title}</Text>
        {detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle | ViewStyle[] }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.slate500}
        {...props}
        style={[styles.input, props.multiline && styles.multiline, props.style]}
      />
      {error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled = false,
  tone = "primary",
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "primary"
          ? styles.buttonPrimary
          : tone === "danger"
            ? styles.buttonDanger
            : styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text
        style={
          tone === "secondary" ? styles.buttonSecondaryText : styles.buttonText
        }
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Notice({
  children,
  tone = "error",
}: PropsWithChildren<{ tone?: "error" | "info" | "success" }>) {
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : "text"}
      style={[
        styles.notice,
        tone === "error"
          ? styles.noticeError
          : tone === "success"
            ? styles.noticeSuccess
            : styles.noticeInfo,
      ]}
    >
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.forest600} size="large" />
      <Text style={styles.detail}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </Card>
  );
}

export function StatusPill({ value }: { value: string }) {
  const success = ["ACTIVE", "SUCCESS", "APPROVED", "LOW"].includes(value);
  const danger = ["FAILED", "BLOCKED", "REJECTED", "FROZEN"].includes(value);
  return (
    <View
      style={[
        styles.pill,
        success ? styles.pillSuccess : danger ? styles.pillDanger : styles.pillWarn,
      ]}
    >
      <Text style={styles.pillText}>{value.replaceAll("_", " ")}</Text>
    </View>
  );
}

export const uiStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  muted: { color: colors.slate500, fontSize: 13, lineHeight: 19 },
  metric: { color: colors.ink, fontSize: 26, fontWeight: "900" },
  gap: { gap: spacing.md },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  screenContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 110,
    gap: spacing.lg,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  brandIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.forest900,
  },
  brandHand: { fontSize: 22 },
  brandName: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  brandTag: { color: colors.slate500, fontSize: 11, marginTop: 2 },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: colors.forest600,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  title: { color: colors.ink, fontSize: 29, lineHeight: 35, fontWeight: "900" },
  detail: { color: colors.slate500, fontSize: 14, lineHeight: 21, marginTop: 5 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.slate200,
    borderWidth: 1,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: colors.forest950,
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  field: { gap: 7 },
  label: { color: colors.slate700, fontSize: 13, fontWeight: "700" },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  multiline: { minHeight: 96, paddingTop: 14, textAlignVertical: "top" },
  fieldError: { color: colors.danger, fontSize: 12 },
  button: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: colors.forest600 },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.slate300,
  },
  buttonDanger: { backgroundColor: colors.danger },
  buttonText: { color: "white", fontWeight: "800", fontSize: 15 },
  buttonSecondaryText: { color: colors.ink, fontWeight: "800", fontSize: 15 },
  buttonDisabled: { opacity: 0.48 },
  buttonPressed: { opacity: 0.84 },
  notice: { borderRadius: 14, borderWidth: 1, padding: spacing.md },
  noticeError: { backgroundColor: colors.dangerSoft, borderColor: "#fecaca" },
  noticeSuccess: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  noticeInfo: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe" },
  noticeText: { color: colors.slate700, fontSize: 13, lineHeight: 19 },
  loading: { flex: 1, minHeight: 260, alignItems: "center", justifyContent: "center", gap: spacing.md },
  empty: { alignItems: "center", paddingVertical: spacing.xxl },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillSuccess: { backgroundColor: "#d1fae5" },
  pillDanger: { backgroundColor: "#fee2e2" },
  pillWarn: { backgroundColor: "#fef3c7" },
  pillText: { color: colors.slate700, fontSize: 10, fontWeight: "900" },
});
