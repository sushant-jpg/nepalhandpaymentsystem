import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PalmQualityResult } from "@nepal-hand-pay/shared-types";
import { Button, Notice } from "./ui";
import { colors, spacing } from "../theme";

interface PalmCameraProps {
  busy?: boolean;
  captureLabel?: string;
  assessFrames?(samples: string[]): Promise<PalmQualityResult>;
  onCapture(samples: string[]): Promise<void> | void;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function PalmCamera({
  busy = false,
  captureLabel = "Capture palm",
  assessFrames,
  onCapture,
}: PalmCameraProps) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [feedback, setFeedback] = useState("Place one palm inside the guide");
  const [error, setError] = useState("");

  async function capture() {
    if (!camera.current || capturing || busy) return;
    setCapturing(true);
    setError("");
    setFeedback("Hold steady · Capturing");
    try {
      const samples: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const picture = await camera.current.takePictureAsync({
          base64: true,
          quality: 0.65,
          skipProcessing: false,
          shutterSound: false,
        });
        if (!picture?.base64) throw new Error("Palm image could not be captured.");
        samples.push(`data:image/jpeg;base64,${picture.base64}`);
        if (index < 2) await wait(300);
      }
      if (assessFrames) {
        setFeedback("Checking lighting, blur, and stability");
        const quality = await assessFrames(samples);
        if (!quality.detected)
          throw new Error("Palm not detected. Move your hand closer and try again.");
        if (!quality.stable)
          throw new Error("Image blurry. Hold steady and try again.");
        if (quality.qualityScore < 0.18)
          throw new Error("Palm image quality is too low. Improve the lighting and try again.");
      }
      setFeedback("Capture successful");
      await onCapture(samples);
    } catch (caught) {
      setFeedback("Try again");
      setError(caught instanceof Error ? caught.message : "Palm capture failed.");
    } finally {
      setCapturing(false);
    }
  }

  if (!permission)
    return <Text style={styles.feedback}>Checking camera permission…</Text>;
  if (!permission.granted)
    return (
      <View style={styles.stack}>
        <Notice>Camera permission is required for palm capture.</Notice>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
      </View>
    );

  return (
    <View style={styles.stack}>
      <View style={styles.preview}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        <View pointerEvents="none" style={styles.guide} />
        <View style={styles.feedbackBar}>
          <Text style={styles.feedback}>{feedback}</Text>
        </View>
      </View>
      {error && <Notice>{error}</Notice>}
      <Button
        title={capturing ? "Capturing 3 still frames…" : captureLabel}
        disabled={capturing || busy}
        onPress={() => void capture()}
      />
      <Text style={styles.note}>
        Three controlled still frames are checked. Video is never uploaded. This prototype does not claim certified liveness detection.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  preview: {
    aspectRatio: 3 / 4,
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: colors.forest950,
  },
  guide: {
    position: "absolute",
    left: "14%",
    right: "14%",
    top: "18%",
    bottom: "18%",
    borderWidth: 2,
    borderColor: colors.emerald300,
    borderRadius: 90,
  },
  feedbackBar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(6,39,30,.84)",
    padding: spacing.md,
  },
  feedback: { color: "white", textAlign: "center", fontWeight: "800" },
  note: { color: colors.slate500, fontSize: 12, lineHeight: 18 },
});
