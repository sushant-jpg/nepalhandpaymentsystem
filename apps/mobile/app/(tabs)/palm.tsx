import { Redirect } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import type { PalmQualityResult } from "@nepal-hand-pay/shared-types";
import { PalmCamera } from "@/components/PalmCamera";
import { Button, Card, Loading, Notice, PageHeader, Screen, StatusPill, uiStyles } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useApiData } from "@/hooks/useApiData";
import { api } from "@/lib/api";

interface PalmStatus {
  enrolled: boolean;
  handSide?: "LEFT" | "RIGHT";
  algorithmVersion?: string;
  enrolledAt?: string;
}

export default function PalmScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { data, error, loading, reload } = useApiData(() =>
    api.request<PalmStatus>("/palm/status"),
  );
  const [mode, setMode] = useState<"STATUS" | "ENROLL" | "VERIFY">("STATUS");
  const [side, setSide] = useState<"LEFT" | "RIGHT">("RIGHT");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  if (user?.role !== "CUSTOMER") return <Redirect href="/(tabs)" />;
  if (loading) return <Loading label="Loading palm enrollment…" />;

  const assess = (samples: string[]) =>
    api.request<PalmQualityResult>("/palm/quality", {
      method: "POST",
      body: { samples },
    });

  async function enroll(samples: string[]) {
    setBusy(true);
    setActionError("");
    try {
      await api.request("/palm/enroll", {
        method: "POST",
        body: { handSide: side, consent: true, samples },
      });
      setMessage("Capture successful. Your prototype palm template is active.");
      setMode("STATUS");
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Palm enrollment failed.");
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  async function verify(samples: string[]) {
    const image = samples.at(-1);
    if (!image) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await api.request<{ matched: boolean; similarity?: number }>(
        "/palm/verify",
        { method: "POST", body: { image } },
      );
      setMessage(
        result.matched
          ? `Palm verification succeeded${result.similarity ? ` (${(result.similarity * 100).toFixed(1)}%)` : ""}. No payment was authorized.`
          : "Palm verification failed. Try again with steady positioning and even lighting.",
      );
      setMode("STATUS");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Palm verification failed.");
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setActionError("");
    try {
      await api.request("/palm", { method: "DELETE" });
      setMessage("Palm enrollment removed.");
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Palm removal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <PageHeader eyebrow={t("palmPay")} title="Palm enrollment & verification" detail="Enrollment, identity checks, and payment confirmation remain separate steps." />
      {(error || actionError) && <Notice>{actionError || error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      {mode === "STATUS" && (
        <Card>
          <View style={uiStyles.rowBetween}>
            <Text style={uiStyles.sectionTitle}>My palm</Text>
            <StatusPill value={data?.enrolled ? "ACTIVE" : "NOT ENROLLED"} />
          </View>
          <Text style={uiStyles.muted}>RGB-camera prototype only. It is not certified palm-vein or liveness detection.</Text>
          {!data?.enrolled ? (
            <Button title="Enroll palm" onPress={() => setMode("ENROLL")} />
          ) : (
            <>
              <Button title="Verify palm" onPress={() => setMode("VERIFY")} />
              <Button title="Remove enrollment" tone="danger" disabled={busy} onPress={() => void remove()} />
            </>
          )}
        </Card>
      )}

      {mode === "ENROLL" && (
        <Card>
          <Text style={uiStyles.sectionTitle}>Choose hand</Text>
          <View style={uiStyles.row}>
            <View style={{ flex: 1 }}><Button title="Left" tone={side === "LEFT" ? "primary" : "secondary"} onPress={() => setSide("LEFT")} /></View>
            <View style={{ flex: 1 }}><Button title="Right" tone={side === "RIGHT" ? "primary" : "secondary"} onPress={() => setSide("RIGHT")} /></View>
          </View>
          <PalmCamera busy={busy} captureLabel="Capture 3 enrollment frames" assessFrames={assess} onCapture={enroll} />
          <Button title="Cancel" tone="secondary" onPress={() => setMode("STATUS")} />
        </Card>
      )}

      {mode === "VERIFY" && (
        <Card>
          <Text style={uiStyles.sectionTitle}>Verify identity</Text>
          <Text style={uiStyles.muted}>This check does not authorize or initiate a payment.</Text>
          <PalmCamera busy={busy} captureLabel="Verify palm" assessFrames={assess} onCapture={verify} />
          <Button title="Cancel" tone="secondary" onPress={() => setMode("STATUS")} />
        </Card>
      )}
    </Screen>
  );
}
