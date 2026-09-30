import * as Crypto from "expo-crypto";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Redirect } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  parseQrPayload,
  type QrPaymentRequestView,
} from "@nepal-hand-pay/shared-types";
import { Button, Card, Field, Notice, PageHeader, Screen, StatusPill, uiStyles } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { api } from "@/lib/api";
import { dateTime, npr } from "@/lib/format";
import { parseMinorUnits } from "@/lib/money";
import { colors, spacing } from "@/theme";

type Stage = "SCAN" | "STATIC_AMOUNT" | "REVIEW" | "RECEIPT";
interface MerchantView {
  merchantId: string;
  merchantName: string;
  currency: "NPR";
}
interface Confirmation {
  state: string;
  requiresPin?: boolean;
  requiresOtp?: boolean;
  developmentOtp?: string;
  transactionId?: string;
  merchantName?: string;
  totalMinor?: number;
  currency?: "NPR";
  orderReference?: string;
  requestId?: string;
  paymentMethod?: "QR";
  completedAt?: string;
}

export default function QrPayScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>("SCAN");
  const [scanLocked, setScanLocked] = useState(false);
  const [merchant, setMerchant] = useState<MerchantView | null>(null);
  const [request, setRequest] = useState<QrPaymentRequestView | null>(null);
  const [result, setResult] = useState<Confirmation | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [pin, setPin] = useState("");
  const [otp, setOtp] = useState("");
  const [requiresPin, setRequiresPin] = useState(false);
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [developmentOtp, setDevelopmentOtp] = useState("");
  const [nonce, setNonce] = useState("");
  const [createKey, setCreateKey] = useState(() => Crypto.randomUUID());
  const [confirmKey, setConfirmKey] = useState(() => Crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user?.role !== "CUSTOMER") return <Redirect href="/(tabs)" />;

  async function processQr(raw: string) {
    if (scanLocked || busy) return;
    setScanLocked(true);
    setBusy(true);
    setError("");
    try {
      const payload = parseQrPayload(raw.trim());
      if (payload.type === "merchant") {
        const details = await api.request<MerchantView>(
          `/qr/merchants/${payload.merchantId}`,
        );
        setMerchant(details);
        setStage("STATIC_AMOUNT");
      } else {
        const details = await api.request<QrPaymentRequestView>(
          `/qr/payment-requests/${payload.paymentRequestId}?nonce=${encodeURIComponent(payload.nonce)}`,
        );
        if (details.merchantId !== payload.merchantId)
          throw new Error("The merchant in this QR does not match the server record.");
        if (!["CREATED", "AWAITING_CONFIRMATION", "AWAITING_PIN"].includes(details.state))
          throw new Error(details.state === "EXPIRED" ? t("qrExpired") : t("invalidQr"));
        setNonce(payload.nonce);
        setRequest(details);
        setStage("REVIEW");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("invalidQr"));
      setScanLocked(false);
    } finally {
      setBusy(false);
    }
  }

  async function createStaticRequest() {
    if (!merchant) return;
    const amountMinor = parseMinorUnits(amount);
    if (!amountMinor) {
      setError("Enter a valid amount with no more than two decimal places.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await api.request<QrPaymentRequestView>(
        "/qr/merchant-payment-requests",
        {
          method: "POST",
          idempotencyKey: createKey,
          body: {
            merchantId: merchant.merchantId,
            amountMinor,
            currency: "NPR",
            description: description.trim() || undefined,
            orderReference: orderReference.trim() || undefined,
            expiresInSeconds: 300,
          },
        },
      );
      setRequest(created);
      setConfirmKey(Crypto.randomUUID());
      setStage("REVIEW");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "QR request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(decision: "CONFIRM" | "DECLINE") {
    if (!request || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.request<Confirmation>(
        `/qr/payment-requests/${request.id}/confirm`,
        {
          method: "POST",
          idempotencyKey: confirmKey,
          timeoutMs: 35_000,
          body: {
            decision,
            pin: pin || undefined,
            otp: otp || undefined,
            nonce: nonce || undefined,
          },
        },
      );
      if (decision === "DECLINE") {
        reset();
        return;
      }
      if (response.state === "AWAITING_CONFIRMATION") {
        setRequiresPin(Boolean(response.requiresPin));
        setRequiresOtp(Boolean(response.requiresOtp));
        setDevelopmentOtp(response.developmentOtp ?? "");
      } else if (response.state === "SUCCESS" && response.transactionId) {
        setResult(response);
        setStage("RECEIPT");
      } else {
        throw new Error("The payment status could not be confirmed.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("paymentFailed"));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("SCAN");
    setScanLocked(false);
    setMerchant(null);
    setRequest(null);
    setResult(null);
    setAmount("");
    setDescription("");
    setOrderReference("");
    setPin("");
    setOtp("");
    setRequiresPin(false);
    setRequiresOtp(false);
    setDevelopmentOtp("");
    setNonce("");
    setError("");
    setCreateKey(Crypto.randomUUID());
    setConfirmKey(Crypto.randomUUID());
  }

  return (
    <Screen>
      <PageHeader eyebrow={t("qrPay")} title={t("scanQr")} detail="Scanning never pays automatically. Review authoritative details before confirmation." />
      {error && <Notice>{error}</Notice>}

      {stage === "SCAN" && (
        <Card>
          {!permission?.granted ? (
            <View style={styles.stack}>
              <Notice>CAMERA_PERMISSION_REQUIRED: Camera access is required to scan QR codes.</Notice>
              <Button title="Allow camera" onPress={() => void requestPermission()} />
            </View>
          ) : (
            <View style={styles.cameraWrap}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={scanLocked ? undefined : ({ data }) => void processQr(data)}
              />
              <View pointerEvents="none" style={styles.scanGuide} />
              <Text style={styles.scanText}>{busy ? "Loading payment details…" : "Point the camera at a Nepal Hand Pay QR"}</Text>
            </View>
          )}
        </Card>
      )}

      {stage === "STATIC_AMOUNT" && merchant && (
        <Card>
          <Text style={uiStyles.sectionTitle}>{merchant.merchantName}</Text>
          <Text style={uiStyles.muted}>Verify this merchant, then enter the amount.</Text>
          <Field label={`${t("amount")} (NPR)`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Description (optional)" value={description} onChangeText={setDescription} maxLength={180} />
          <Field label="Order reference (optional)" value={orderReference} onChangeText={setOrderReference} maxLength={80} />
          <Button title={busy ? "Preparing…" : "Review payment"} disabled={busy} onPress={() => void createStaticRequest()} />
          <Button title="Scan another QR" tone="secondary" onPress={reset} />
        </Card>
      )}

      {stage === "REVIEW" && request && (
        <Card>
          <View style={uiStyles.rowBetween}>
            <Text style={uiStyles.sectionTitle}>{request.merchantName}</Text>
            <StatusPill value={request.state} />
          </View>
          <Text style={styles.total}>{npr(request.totalMinor / 100)}</Text>
          <View style={styles.details}>
            <Text style={uiStyles.muted}>{t("merchant")}: {request.merchantName}</Text>
            {request.description && <Text style={uiStyles.muted}>Description: {request.description}</Text>}
            {request.orderReference && <Text style={uiStyles.muted}>Order: {request.orderReference}</Text>}
            <Text style={uiStyles.muted}>Fee: {npr(request.feeMinor / 100)}</Text>
            <Text style={uiStyles.muted}>Expires: {dateTime(request.expiresAt)}</Text>
          </View>
          {requiresPin && <Field label="Payment PIN" value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, ""))} keyboardType="number-pad" secureTextEntry maxLength={8} />}
          {requiresOtp && <Field label={`One-time code${developmentOtp ? ` (development: ${developmentOtp})` : ""}`} value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={6} />}
          <Notice tone="info">Amount, currency, merchant, fees, and status came from the API—not from the scanned text.</Notice>
          <Button title={busy ? "Processing…" : t("confirmPayment")} disabled={busy || (requiresPin && pin.length < 4) || (requiresOtp && otp.length !== 6)} onPress={() => void confirm("CONFIRM")} />
          <Button title="Decline" tone="secondary" disabled={busy} onPress={() => void confirm("DECLINE")} />
        </Card>
      )}

      {stage === "RECEIPT" && result?.transactionId && (
        <Card>
          <Text style={styles.success}>{t("paymentSuccessful")}</Text>
          <Text style={styles.total}>{npr((result.totalMinor ?? 0) / 100)}</Text>
          <Text style={uiStyles.muted}>{t("merchant")}: {result.merchantName}</Text>
          <Text style={uiStyles.muted}>Transaction ID: {result.transactionId}</Text>
          <Text style={uiStyles.muted}>Request ID: {result.requestId}</Text>
          <Text style={uiStyles.muted}>Payment method: QR</Text>
          <Text style={uiStyles.muted}>Status: SUCCESS</Text>
          <Text style={uiStyles.muted}>Date: {result.completedAt ? dateTime(result.completedAt) : "—"}</Text>
          <Button title="Scan another QR" onPress={reset} />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  cameraWrap: { aspectRatio: 1, overflow: "hidden", borderRadius: 20, backgroundColor: colors.forest950 },
  scanGuide: { position: "absolute", left: "14%", right: "14%", top: "14%", bottom: "14%", borderWidth: 3, borderColor: colors.emerald300, borderRadius: 24 },
  scanText: { position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.md, padding: spacing.md, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(6,39,30,.84)", color: "white", textAlign: "center", fontWeight: "800" },
  total: { color: colors.ink, fontSize: 34, fontWeight: "900", textAlign: "center" },
  details: { gap: spacing.sm },
  success: { color: colors.forest600, fontSize: 18, fontWeight: "900", textAlign: "center", textTransform: "uppercase" },
});
