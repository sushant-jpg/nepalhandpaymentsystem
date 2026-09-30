import * as Crypto from "expo-crypto";
import { Redirect } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import type { PalmQualityResult } from "@nepal-hand-pay/shared-types";
import { PalmCamera } from "@/components/PalmCamera";
import { Button, Card, Field, Notice, PageHeader, Screen, StatusPill, uiStyles } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { api } from "@/lib/api";
import { npr } from "@/lib/format";
import { parseMinorUnits } from "@/lib/money";
import { colors } from "@/theme";

type Stage = "AMOUNT" | "SCAN" | "CONFIRM" | "RECEIPT";
interface Payment { id: string; amount: number; state: string; expiresAt: string }
interface Match {
  customerName: string;
  amount: number;
  merchantName: string;
  similarity: number;
  riskLevel: string;
  requiresPin: boolean;
  requiresOtp: boolean;
  confirmationToken: string;
  developmentOtp?: string;
}
interface Result { state: string; transactionId?: string; amount: number; remainingBalance: number }

export default function PalmPayScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [stage, setStage] = useState<Stage>("AMOUNT");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createKey, setCreateKey] = useState(() => Crypto.randomUUID());
  const [confirmKey, setConfirmKey] = useState(() => Crypto.randomUUID());

  if (user?.role !== "MERCHANT") return <Redirect href="/(tabs)" />;

  async function create() {
    const amountMinor = parseMinorUnits(amount);
    if (!amountMinor) {
      setError("Enter a valid amount with no more than two decimal places.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.request<Payment>("/payments/requests", {
        method: "POST",
        idempotencyKey: createKey,
        body: {
          amount: amountMinor / 100,
          description: description.trim() || undefined,
          orderReference: orderReference.trim() || undefined,
        },
      });
      setPayment(created);
      setStage("SCAN");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Payment request failed.");
    } finally {
      setBusy(false);
    }
  }

  const assess = (samples: string[]) => {
    if (!payment) throw new Error("Create the payment first.");
    return api.request<PalmQualityResult>(`/payments/requests/${payment.id}/quality`, {
      method: "POST",
      body: { samples },
    });
  };

  async function identify(samples: string[]) {
    const image = samples.at(-1);
    if (!payment || !image) return;
    setBusy(true);
    setError("");
    try {
      const found = await api.request<Match>(`/payments/requests/${payment.id}/identify`, {
        method: "POST",
        body: { image },
      });
      setMatch(found);
      setConfirmKey(Crypto.randomUUID());
      setStage("CONFIRM");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Palm identification failed.");
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  async function confirm(decision: "CONFIRM" | "DECLINE") {
    if (!payment || !match) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.request<Result>(`/payments/requests/${payment.id}/confirm`, {
        method: "POST",
        idempotencyKey: confirmKey,
        timeoutMs: 35_000,
        body: {
          confirmationToken: match.confirmationToken,
          decision,
          pin: pin || undefined,
          otp: otp || undefined,
        },
      });
      if (decision === "DECLINE") reset();
      else if (response.transactionId) {
        setResult(response);
        setStage("RECEIPT");
      } else {
        throw new Error("Payment is still processing. Check transaction history before retrying.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("paymentFailed"));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("AMOUNT");
    setPayment(null);
    setMatch(null);
    setResult(null);
    setAmount("");
    setDescription("");
    setOrderReference("");
    setPin("");
    setOtp("");
    setError("");
    setCreateKey(Crypto.randomUUID());
    setConfirmKey(Crypto.randomUUID());
  }

  return (
    <Screen>
      <PageHeader eyebrow="Merchant POS" title={t("palmPay")} detail="Amount → controlled palm capture → review → explicit confirmation." />
      {error && <Notice>{error}</Notice>}
      {stage === "AMOUNT" && <Card><Field label={`${t("amount")} (NPR)`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><Field label="Description (optional)" value={description} onChangeText={setDescription} /><Field label="Order reference (optional)" value={orderReference} onChangeText={setOrderReference} /><Button title={busy ? "Creating…" : "Request palm payment"} disabled={busy} onPress={() => void create()} /></Card>}
      {stage === "SCAN" && payment && <Card><Text style={styles.total}>{npr(payment.amount)}</Text><StatusPill value="WAITING FOR PALM" /><PalmCamera busy={busy} captureLabel="Identify customer palm" assessFrames={assess} onCapture={identify} /><Button title="Cancel" tone="secondary" onPress={reset} /></Card>}
      {stage === "CONFIRM" && match && <Card><Text style={uiStyles.sectionTitle}>{match.customerName}</Text><Text style={styles.total}>{npr(match.amount)}</Text><Text style={uiStyles.muted}>Merchant: {match.merchantName}</Text><Text style={uiStyles.muted}>Match confidence: {(match.similarity * 100).toFixed(1)}% · Risk: {match.riskLevel}</Text>{match.requiresPin && <Field label="Customer payment PIN" value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, ""))} secureTextEntry keyboardType="number-pad" maxLength={8} />}{match.requiresOtp && <Field label={`One-time code${match.developmentOtp ? ` (development: ${match.developmentOtp})` : ""}`} value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} />}<Notice tone="info">Palm identification alone does not authorize payment. The customer must review and confirm.</Notice><Button title={busy ? "Processing…" : t("confirmPayment")} disabled={busy || (match.requiresPin && pin.length < 4) || (match.requiresOtp && otp.length !== 6)} onPress={() => void confirm("CONFIRM")} /><Button title="Decline" tone="secondary" disabled={busy} onPress={() => void confirm("DECLINE")} /></Card>}
      {stage === "RECEIPT" && result?.transactionId && <Card><Text style={styles.success}>{t("paymentSuccessful")}</Text><Text style={styles.total}>{npr(result.amount)}</Text><Text style={uiStyles.muted}>Transaction ID: {result.transactionId}</Text><Text style={uiStyles.muted}>Payment method: Palm Pay</Text><Text style={uiStyles.muted}>Status: SUCCESS</Text><Button title="New payment" onPress={reset} /></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { color: colors.ink, fontSize: 34, fontWeight: "900", textAlign: "center" },
  success: { color: colors.forest600, fontSize: 18, fontWeight: "900", textAlign: "center", textTransform: "uppercase" },
});
