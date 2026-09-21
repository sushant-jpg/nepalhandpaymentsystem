import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, RefreshCw } from "lucide-react";
import { Notice } from "./Ui";

export function CameraCapture({ onCapture, captureLabel = "Capture palm", busy = false }: { onCapture(image: string): void; captureLabel?: string; busy?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  async function start() {
    setError(""); setReady(false);
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setReady(true); }
    } catch { setError("Camera access is required. Check browser permissions or use a device with a camera."); }
  }
  useEffect(() => { void start(); return () => streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(video.videoWidth, 960); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.86));
  }

  return <div>
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-950">
      <video ref={videoRef} muted playsInline className="h-full w-full object-cover" aria-label="Live camera preview" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-[15%] rounded-[38%] border-2 border-dashed border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.3)]" />
      {ready && <div aria-hidden="true" className="scan-line absolute left-[18%] right-[18%] top-1/2 h-0.5 bg-emerald-300 shadow-[0_0_12px_#6ee7b7]" />}
      {!ready && !error && <div className="absolute inset-0 grid place-items-center text-white"><Camera className="size-8 animate-pulse" /></div>}
    </div>
    {error && <div className="mt-3"><Notice>{error}</Notice></div>}
    <div className="mt-4 flex gap-3"><button type="button" className="btn-primary flex-1" onClick={capture} disabled={!ready || busy}><Camera size={18} />{busy ? "Processing…" : captureLabel}</button><button type="button" className="btn-secondary px-3" onClick={() => void start()} aria-label="Restart camera"><RefreshCw size={18} /></button></div>
    <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><CameraOff size={14} />Images are processed for feature extraction and are not retained by default.</p>
  </div>;
}
