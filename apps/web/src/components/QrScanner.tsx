import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Keyboard, RefreshCw, ScanLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Notice } from "./Ui";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

function detectorConstructor(): BarcodeDetectorConstructor | undefined {
  return (
    globalThis as typeof globalThis & {
      BarcodeDetector?: BarcodeDetectorConstructor;
    }
  ).BarcodeDetector;
}

export function QrScanner({
  onScan,
}: {
  onScan(value: string): void | Promise<void>;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: "", at: 0 });
  const mountedRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (mountedRef.current) setReady(false);
  }, []);

  const start = useCallback(async () => {
    stop();
    setError("");
    setManualMode(false);
    processingRef.current = false;
    const Detector = detectorConstructor();
    if (!Detector) {
      setManualMode(true);
      setError(t("qr.scannerUnsupported"));
      return;
    }
    try {
      const supported = await Detector.getSupportedFormats?.();
      if (supported && !supported.includes("qr_code"))
        throw new Error(t("qr.scannerUnsupported"));
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
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
      }
    } catch (caught) {
      setManualMode(true);
      setError(
        caught instanceof Error && caught.message === t("qr.scannerUnsupported")
          ? caught.message
          : t("qr.cameraPermission"),
      );
    }
  }, [stop, t]);

  useEffect(() => {
    mountedRef.current = true;
    void start();
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [start, stop]);

  useEffect(() => {
    if (!ready) return;
    const Detector = detectorConstructor();
    if (!Detector) return;
    const detector = new Detector({ formats: ["qr_code"] });
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || processingRef.current || video.readyState < 2) return;
      processingRef.current = true;
      void detector
        .detect(video)
        .then(async (codes) => {
          const value = codes[0]?.rawValue?.trim();
          if (!value) return;
          const now = Date.now();
          if (
            value === lastScanRef.current.value &&
            now - lastScanRef.current.at < 2_000
          )
            return;
          lastScanRef.current = { value, at: now };
          stop();
          await onScan(value);
        })
        .catch(() => undefined)
        .finally(() => {
          processingRef.current = false;
        });
    }, 350);
    return () => window.clearInterval(timer);
  }, [onScan, ready, stop]);

  async function submitManual() {
    const value = manual.trim();
    if (!value || processingRef.current) return;
    processingRef.current = true;
    try {
      await onScan(value);
    } finally {
      processingRef.current = false;
    }
  }

  return (
    <div>
      {!manualMode && (
        <div className="relative mx-auto aspect-square max-w-xl overflow-hidden rounded-3xl bg-slate-950">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            aria-label={t("qr.cameraPreview")}
          />
          <div className="pointer-events-none absolute inset-[14%] rounded-3xl border-2 border-dashed border-emerald-300 shadow-[0_0_0_999px_rgba(0,0,0,.4)]" />
          <div className="absolute inset-x-4 bottom-4 flex items-center justify-center gap-2 rounded-xl bg-slate-950/75 px-4 py-3 text-sm font-semibold text-white backdrop-blur">
            <ScanLine className="size-4 text-emerald-300" />
            {ready ? t("qr.pointCamera") : t("qr.startingCamera")}
          </div>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice>{error}</Notice>
        </div>
      )}
      {manualMode && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
          <label className="label" htmlFor="manual-qr-payload">
            {t("qr.pastePayload")}
          </label>
          <textarea
            id="manual-qr-payload"
            className="input min-h-28 resize-y font-mono text-xs"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button
            type="button"
            className="btn-primary mt-4 w-full"
            disabled={!manual.trim()}
            onClick={() => void submitManual()}
          >
            <Keyboard size={17} />
            {t("qr.reviewCode")}
          </button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" onClick={() => void start()}>
          <RefreshCw size={17} />
          {t("qr.restartScanner")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            stop();
            setManualMode(true);
          }}
        >
          {ready ? <CameraOff size={17} /> : <Camera size={17} />}
          {t("qr.enterManually")}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">{t("qr.localScanNotice")}</p>
    </div>
  );
}
