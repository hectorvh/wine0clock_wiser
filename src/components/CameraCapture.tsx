import { useRef, useState, useCallback } from "react";
import { Camera, SwitchCamera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
      }
    } catch (err) {
      console.error("Camera access denied:", err);
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], "wine-photo.jpg", { type: "image/jpeg" });
          stopCamera();
          onCapture(file);
        }
      },
      "image/jpeg",
      0.9
    );
  }, [onCapture, stopCamera]);

  const toggleFacing = () => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  // Auto-start on mount
  useState(() => {
    startCamera();
  });

  return (
    <div className="relative w-full rounded-xl overflow-hidden glass-card">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full aspect-[4/3] object-cover bg-muted"
      />
      <canvas ref={canvasRef} className="hidden" />

      <div className="absolute top-3 right-3 flex gap-2">
        <Button
          size="icon"
          variant="secondary"
          className="rounded-full bg-background/60 backdrop-blur-md"
          onClick={toggleFacing}
        >
          <SwitchCamera className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          className="rounded-full bg-background/60 backdrop-blur-md"
          onClick={() => {
            stopCamera();
            onClose();
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {streaming && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <button
            onClick={takePhoto}
            className="w-16 h-16 rounded-full border-4 border-foreground/80 bg-foreground/20 backdrop-blur-md hover:bg-foreground/40 transition-all active:scale-90"
            aria-label="Take photo"
          />
        </div>
      )}

      {!streaming && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <Button onClick={startCamera} variant="secondary">
            <Camera className="mr-2 h-4 w-4" /> Start Camera
          </Button>
        </div>
      )}
    </div>
  );
}
