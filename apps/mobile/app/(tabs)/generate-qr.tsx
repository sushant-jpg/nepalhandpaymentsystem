import * as Crypto from "expo-crypto";
import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { QrPaymentRequestView } from "@nepal-hand-pay/shared-types";
import { QrMatrix } from "@/components/QrMatrix";
import { Button, Card, Field, Notice, PageHeader, Screen, StatusPill, uiStyles } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { api } from "@/lib/api";
import { dateTime, npr } from "@/lib/format";
import { parseMinorUnits } from "@/lib/money";
import { colors, spacing } from "@/theme";

interface StaticQr {
  merchantName: string;
  qrPayload: string;
}
interface DynamicQr extends QrPaymentRequestView {
  qrPayload: string;
}
const terminal = new Set(["SUCCESS", "FAILED", "EXPIRED", "CANCELLED", "BLOCKED"]);

export default function GenerateQrScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [mode, setMode] = useState<"DYNAMIC" | "STATIC">("DYNAMIC");
  const [staticQr, setStaticQr] = useState<StaticQr | null>(null);
  const [payment, setPayment] = useState<DynamicQr | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [status, setStatus] = useState("CREATED");
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(Crypto.randomUUID());

  const loadStatic = useCallback(async () => {
    try {
      setStaticQr(await api.request<StaticQr>("/qr/merchant"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Merchant QR unavailable.");
    }
  }, []);
  useFocusEffect(useCallback(() => void loadStatic(), [loadStatic]));

  const refresh = useCallback(async () => {
    if (!payment || terminal.has(status)) return;
    try {
      const current = await api.request<QrPaymentRequestView>(
        `/qr/payment-requests/${payment.id}`,
      );
      setStatus(current.state);
      setPayment((value) => (value ? { ...value, ...current } : value));
    } catch (caught) {
      if (caught instanceof Error) setError(caught.message);
    }
  }, [payment, status]);

  useEffect(() => {
    if (!payment || terminal.has(status)) return;
    const poll = setInterval(() => void refresh(), 2_500);
    const tick = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((new Date(payment.expiresAt).getTime() - Date.now()) / 1_000));
      setRemaining(seconds);
      if (seconds === 0) void refresh();
    }, 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [payment, refresh, status]);

  if (user?.role !== "MERCHANT") return <Redirect href="/(tabs)" />;

  async function generate() {
    const amountMinor = parseMinorUnits(amount);
    if (!amountMinor) {
      setError("Enter a valid amount with no more than two decimal places.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.request<DynamicQr>("/qr/payment-requests", {
        method: "POST",
        idempotencyKey: key.current,
        body: {
          amountMinor,
          currency: "NPR",
          description: description.trim() || undefined,
          orderReference: orderReference.trim() || undefined,
          expiresInSeconds: 300,
        },
      });
      setPayment(created);
      setStatus(created.state);
      setRemaining(Math.max(0, Math.ceil((new Date(created.expiresAt).getTime() - Date.now()) / 1_000)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "QR generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!payment || busy) return;
    setBusy(true);
    try {
      await api.request(`/qr/payment-requests/${payment.id}/cancel`, { method: "POST" });
      setStatus("CANCELLED");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cancellation failed.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    key.current = Crypto.randomUUID();
    setPayment(null);
    setAmount("");
    setDescription("");
    setOrderReference("");
    setStatus("CREATED");
    setError("");
  }

  const countdown = useMemo(
    () => `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`,
    [remaining],
  );

  return (
    <Screen>
      <PageHeader eyebrow="Merchant QR" title={t("generateQr")} detail="Create a five-minute payment request or show your reusable merchant QR." />
      {error && <Notice>{error}</Notice>}
      <View style={styles.modeRow}>
        <View style={styles.modeButton}><Button title="Dynamic QR" tone={mode === "DYNAMIC" ? "primary" : "secondary"} onPress={() => setMode("DYNAMIC")} /></View>
        <View style={styles.modeButton}><Button title="Static QR" tone={mode === "STATIC" ? "primary" : "secondary"} onPress={() => setMode("STATIC")} /></View>
      </View>

      {mode === "STATIC" && staticQr && (
        <Card>
          <QrMatrix value={staticQr.qrPayload} />
          <Text style={styles.centerTitle}>{staticQr.merchantName}</Text>
          <Text style={[uiStyles.muted, styles.center]}>Customer enters the amount after scanning. Merchant identity is validated by the server.</Text>
        </Card>
      )}

      {mode === "DYNAMIC" && !payment && (
        <Card>
          <Field label={`${t("amount")} (NPR)`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Description (optional)" value={description} onChangeText={setDescription} maxLength={180} />
          <Field label="Order reference (optional)" value={orderReference} onChangeText={setOrderReference} maxLength={80} />
          <Button title={busy ? "Generating…" : t("generateQr")} disabled={busy} onPress={() => void generate()} />
        </Card>
      )}

      {mode === "DYNAMIC" && payment && (
        <Card>
          <QrMatrix value={payment.qrPayload} />
          <View style={uiStyles.rowBetween}>
            <StatusPill value={status} />
            {!terminal.has(status) && <Text style={styles.countdown}>{countdown}</Text>}
          </View>
          <Text style={styles.total}>{npr(payment.totalMinor / 100)}</Text>
          <Text style={[uiStyles.muted, styles.center]}>{terminal.has(status) ? `Payment ${status.toLowerCase()}.` : "Waiting for customer · status refreshes automatically"}</Text>
          <Text style={[uiStyles.muted, styles.center]}>Expires {dateTime(payment.expiresAt)}</Text>
          {!terminal.has(status) && <Button title="Cancel request" tone="secondary" disabled={busy} onPress={() => void cancel()} />}
          {terminal.has(status) && <Button title="Generate another QR" onPress={reset} />}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: "row", gap: spacing.md },
  modeButton: { flex: 1 },
  center: { textAlign: "center" },
  centerTitle: { color: colors.ink, fontSize: 22, fontWeight: "900", textAlign: "center" },
  total: { color: colors.ink, fontSize: 34, fontWeight: "900", textAlign: "center" },
  countdown: { color: colors.warning, fontWeight: "900", fontVariant: ["tabular-nums"] },
});
