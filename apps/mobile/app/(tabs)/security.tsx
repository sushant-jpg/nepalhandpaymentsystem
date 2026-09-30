import { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, Loading, Notice, PageHeader, Screen, uiStyles } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useApiData } from "@/hooks/useApiData";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";

interface SecurityEvent { _id: string; action: string; category: string; success: boolean; createdAt: string }

export default function SecurityScreen() {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const { data, error, loading, reload } = useApiData(() =>
    api.request<{ items: SecurityEvent[] }>("/security/events?limit=20"),
  );
  async function savePin() {
    setMessage("");
    try {
      await api.request("/users/payment-pin", { method: "POST", body: { password, pin } });
      setPassword("");
      setPin("");
      setMessage("Payment PIN updated securely.");
      await reload();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not update PIN.");
    }
  }
  return (
    <Screen>
      <PageHeader eyebrow="Account protection" title="Security" detail="Review recent security activity and manage customer payment authorization." />
      {user?.role === "CUSTOMER" ? (
        <Card>
          <Text style={uiStyles.sectionTitle}>Payment PIN</Text>
          <Field label="Account password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          <Field label="New 4-8 digit PIN" value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={8} />
          <Button title="Update payment PIN" onPress={() => void savePin()} disabled={!password || !/^\d{4,8}$/.test(pin)} />
          {message ? <Notice tone={message.includes("updated") ? "success" : "error"}>{message}</Notice> : null}
        </Card>
      ) : null}
      <Text style={uiStyles.sectionTitle}>Recent events</Text>
      {loading ? <Loading label="Loading security events..." /> : error ? <Notice>{error}</Notice> : data?.items.map((item) => (
        <Card key={item._id}>
          <Text style={uiStyles.sectionTitle}>{item.action.replaceAll("_", " ")}</Text>
          <Text style={uiStyles.muted}>{item.category} · {item.success ? "Succeeded" : "Failed"} · {dateTime(item.createdAt)}</Text>
        </Card>
      ))}
    </Screen>
  );
}
