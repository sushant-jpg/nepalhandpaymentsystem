import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Hand,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  PalmScanGuard,
  type PalmQualityResult,
  type PalmScanState,
} from "@nepal-hand-pay/shared-types";
import { Notice } from "./Ui";

interface CameraCaptureProps {
  onCapture(image: string): void | Promise<void>;
  assessFrames?(samples: string[]): Promise<PalmQualityResult>;
  captureLabel?: string;
  busy?: boolean;
}

interface FrameSample {
  image: string;
  signature: number[];
  usable: boolean;
}

const stateMessage: Record<PalmScanState, string> = {
  IDLE: "Starting camera…",
  CAMERA_READY: "Camera ready",
  SEARCHING_FOR_PALM: "Place your palm inside the frame",
  PALM_DETECTED: "Palm detected",
  HOLD_STILL: "Palm detected — hold still",
  CAPTURING: "Checking palm quality…",
  IDENTIFYING: "Identifying palm…",
  SUCCESS: "Palm captured",
  FAILED: "Move your palm away, then try again",
};

function signatureDifference(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.MAX_VALUE;
  return left.reduce((sum, value, index) => sum + Math.abs(value - (right[index] ?? 0)), 0) / left.length;
}

function readFrame(video: HTMLVideoElement, maxWidth: number, quality: number): FrameSample | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(video.videoWidth, maxWidth);
  canvas.height = Math.max(1, Math.round((canvas.width * video.videoHeight) / video.videoWidth));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const signature: number[] = [];
  let total = 0;
  let totalSquared = 0;
  let edgeTotal = 0;
  let count = 0;
  let previous = 0;
  const step = Math.max(2, Math.floor(canvas.width / 120));
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const offset = (y * canvas.width + x) * 4;
      const luminance =
        (pixels[offset] ?? 0) * 0.299 +
        (pixels[offset + 1] ?? 0) * 0.587 +
        (pixels[offset + 2] ?? 0) * 0.114;
      total += luminance;
      totalSquared += luminance * luminance;
      if (count > 0) edgeTotal += Math.abs(luminance - previous);
      previous = luminance;
      count += 1;
    }
  }
  const mean = total / Math.max(1, count);
  const contrast = Math.sqrt(Math.max(0, totalSquared / Math.max(1, count) - mean * mean));
  const edge = edgeTotal / Math.max(1, count - 1);

  const columns = 8;
  const rows = 6;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(canvas.width - 1, Math.floor(((column + 0.5) * canvas.width) / columns));
      const y = Math.min(canvas.height - 1, Math.floor(((row + 0.5) * canvas.height) / rows));
      const offset = (y * canvas.width + x) * 4;
      signature.push(
        (pixels[offset] ?? 0) * 0.299 +
          (pixels[offset + 1] ?? 0) * 0.587 +
          (pixels[offset + 2] ?? 0) * 0.114,
      );
    }
  }

  return {
    image: canvas.toDataURL("image/jpeg", quality),
    signature,
    usable: mean >= 30 && mean <= 230 && contrast >= 10 && edge >= 5,
  };
}

export function CameraCapture({
  onCapture,
  assessFrames,
  captureLabel = "Capture palm",
  busy = false,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const guardRef = useRef(new PalmScanGuard());
  const samplesRef = useRef<FrameSample[]>([]);
  const removalBaselineRef = useRef<number[]>([]);
  const samplingRef = useRef(false);
  const mountedRef = useRef(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [scanState, setScanState] = useState<PalmScanState>("IDLE");

  const updateState = useCallback((state: PalmScanState) => {
    guardRef.current.setState(state);
    if (mountedRef.current) setScanState(state);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError("");
    setReady(false);
    updateState("IDLE");
    guardRef.current.reset("IDLE");
    samplesRef.current = [];
    try {
      stop();
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("Camera API unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
        updateState(assessFrames ? "SEARCHING_FOR_PALM" : "CAMERA_READY");
      }
    } catch {
      setError(
        "Camera access is required. Check browser permissions or use a device with a camera.",
      );
      updateState("FAILED");
    }
  }, [assessFrames, stop, updateState]);

  useEffect(() => {
    mountedRef.current = true;
    void start();
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else void start();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [start, stop]);

  const submitAutomaticCapture = useCallback(
    async (frames: FrameSample[]) => {
      if (!assessFrames || !guardRef.current.begin()) return;
      updateState("CAPTURING");
      removalBaselineRef.current = frames.at(-1)?.signature ?? [];
      try {
        const quality = await assessFrames(frames.map((frame) => frame.image));
        if (!quality.detected || !quality.stable)
          throw new Error("Keep one palm centered and steady before trying again.");
        const video = videoRef.current;
        if (!video) throw new Error("Camera preview is unavailable.");
        updateState("IDENTIFYING");
        const finalFrame = readFrame(video, 960, 0.86);
        if (!finalFrame) throw new Error("The palm image could not be captured.");
        removalBaselineRef.current = finalFrame.signature;
        await onCapture(finalFrame.image);
        guardRef.current.finish(true);
        updateState("SUCCESS");
      } catch (caught) {
        guardRef.current.finish(false);
        updateState("FAILED");
        setError(
          caught instanceof Error
            ? caught.message
            : "Palm capture failed. Move your hand away and try again.",
        );
      } finally {
        samplesRef.current = [];
      }
    },
    [assessFrames, onCapture, updateState],
  );

  useEffect(() => {
    if (!ready || !assessFrames) return;
    const timer = window.setInterval(() => {
      if (samplingRef.current || busy || !videoRef.current) return;
      samplingRef.current = true;
      try {
        const frame = readFrame(videoRef.current, 640, 0.68);
        if (!frame) return;
        const guard = guardRef.current;
        if (!guard.isArmed) {
          const changed =
            signatureDifference(frame.signature, removalBaselineRef.current) > 22;
          if (guard.observeRemoval(changed)) {
            setError("");
            samplesRef.current = [];
            setScanState(guard.state);
          }
          return;
        }
        if (guard.isProcessing) return;
        if (!frame.usable) {
          samplesRef.current = [];
          updateState("SEARCHING_FOR_PALM");
          return;
        }
        const previous = samplesRef.current.at(-1);
        if (
          previous &&
          signatureDifference(frame.signature, previous.signature) > 14
        ) {
          samplesRef.current = [frame];
          updateState("PALM_DETECTED");
          return;
        }
        samplesRef.current.push(frame);
        if (samplesRef.current.length === 1) updateState("PALM_DETECTED");
        else updateState("HOLD_STILL");
        if (samplesRef.current.length >= 3) {
          const frames = samplesRef.current.slice(0, 3);
          void submitAutomaticCapture(frames);
        }
      } finally {
        samplingRef.current = false;
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [assessFrames, busy, ready, submitAutomaticCapture, updateState]);

  async function captureManually() {
    const video = videoRef.current;
    if (!video || !ready || busy || !guardRef.current.begin()) return;
    setError("");
    updateState("IDENTIFYING");
    try {
      const frame = readFrame(video, 960, 0.86);
      if (!frame) throw new Error("The palm image could not be captured.");
      removalBaselineRef.current = frame.signature;
      await onCapture(frame.image);
      guardRef.current.finish(true);
      updateState("SUCCESS");
    } catch (caught) {
      guardRef.current.finish(false);
      updateState("FAILED");
      setError(caught instanceof Error ? caught.message : "Palm capture failed.");
    }
  }

  const processing = guardRef.current.isProcessing || busy;
  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-950">
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-full w-full object-cover"
          aria-label="Live camera preview"
        />
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-[15%] rounded-[38%] border-2 border-dashed shadow-[0_0_0_999px_rgba(0,0,0,.3)] ${scanState === "HOLD_STILL" ? "border-emerald-300" : "border-white/80"}`}
        />
        {ready && (
          <div
            aria-hidden="true"
            className="scan-line absolute left-[18%] right-[18%] top-1/2 h-0.5 bg-emerald-300 shadow-[0_0_12px_#6ee7b7]"
          />
        )}
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-white">
            <Camera className="size-8 animate-pulse" />
          </div>
        )}
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-center gap-2 rounded-xl bg-slate-950/75 px-3 py-2 text-center text-sm font-semibold text-white backdrop-blur">
          {processing ? (
            <LoaderCircle className="size-4 animate-spin text-emerald-300" />
          ) : scanState === "SUCCESS" ? (
            <CheckCircle2 className="size-4 text-emerald-300" />
          ) : (
            <Hand className="size-4 text-emerald-300" />
          )}
          {stateMessage[scanState]}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="btn-secondary flex-1"
          onClick={() => void captureManually()}
          disabled={!ready || processing || !guardRef.current.isArmed}
        >
          <Camera size={18} />
          {processing ? "Processing…" : assessFrames ? "Capture now" : captureLabel}
        </button>
        <button
          type="button"
          className="btn-secondary px-3"
          onClick={() => void start()}
          aria-label="Restart camera"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <CameraOff size={14} />
        {assessFrames
          ? "Three still frames are checked for quality and stability. Video is not uploaded."
          : "Images are processed for feature extraction and are not retained by default."}
      </p>
    </div>
  );
}
