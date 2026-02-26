import { useState, useRef, useEffect, ChangeEvent } from "react";
import { X, AlertCircle, Loader2, Upload } from "lucide-react";
import { ScanResult } from "../types";
import storage from "../lib/storage";
import { motion } from "motion/react";
import { analyzeWine } from "../lib/wine-api";

interface ScannerProps {
  onComplete: () => void;
}

export default function Scanner({ onComplete }: ScannerProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManualPrompt, setShowManualPrompt] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    startCamera();
    getCurrentLocation();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch {
      setError("Camera access denied. Please enable camera permissions.");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setError("Location access denied. Logs will not be geotagged."),
      );
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext("2d");
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvasRef.current.toDataURL("image/jpeg");
        setCapturedImage(dataUrl);

        canvasRef.current.toBlob((blob) => {
          if (!blob) return;
          const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
          void performScan(file);
        }, "image/jpeg", 0.92);
      }
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setCapturedImage(dataUrl);
      void performScan(file);
    };
    reader.readAsDataURL(file);
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const performScan = async (file: File) => {
    setIsScanning(true);
    setError(null);
    setShowManualPrompt(false);
    try {
      const result = await analyzeWine(file, "analyzer", "en");
      const vintageNum = result.wine.vintage ? Number.parseInt(result.wine.vintage, 10) : null;
      const country = (result.wine.country ?? "").toLowerCase();
      const isGerman = country.includes("germany") || country.includes("deutsch");
      setScanResult({
        brand: result.wine.full_name ?? "",
        producer: result.wine.producer ?? result.wine.winery ?? "",
        year: Number.isFinite(vintageNum) ? vintageNum : null,
        region: result.wine.region_name ?? "",
        wine_type: result.wine.wine_type ?? "",
        is_german: result.wine.country ? isGerman : true,
        description: result.sensory.tasting_notes ?? "",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to analyze label. Please try again.";
      setError(message);
      setShowManualPrompt(true);
    } finally {
      setIsScanning(false);
    }
  };

  const startManualEntry = () => {
    setScanResult({
      brand: "",
      producer: "",
      year: new Date().getFullYear(),
      region: "",
      wine_type: "",
      is_german: true,
      description: "",
    });
    setError(null);
    setShowManualPrompt(false);
  };

  const handleSave = async (formData: Record<string, unknown>) => {
    try {
      storage.saveBottle({
        ...formData,
        image: capturedImage || "",
        lat: location?.lat,
        lng: location?.lng,
        timestamp: new Date().toISOString(),
      });
      onComplete();
    } catch {
      setError("Failed to save bottle log.");
    }
  };

  if (scanResult) {
    return (
      <div className="p-6 pb-32 min-h-screen bg-[#F5F5F0]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-serif italic text-[#5A5A40]">Confirm Details</h2>
          <button
            onClick={() => { setScanResult(null); setCapturedImage(null); setShowManualPrompt(false); }}
            className="p-2 text-[#A1A19A] hover:text-[#5A5A40]"
          >
            <X size={20} />
          </button>
        </div>
        <BottleForm
          initialData={scanResult}
          onSave={handleSave}
          onCancel={() => { setScanResult(null); setCapturedImage(null); setShowManualPrompt(false); }}
          currentCoords={location}
        />
      </div>
    );
  }

  return (
    <div className="relative h-screen bg-black overflow-hidden">
      {!capturedImage ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <img src={capturedImage} className="absolute inset-0 w-full h-full object-cover opacity-50" />
      )}

      <div className="absolute inset-0 flex flex-col justify-between p-6 pointer-events-none">
        <div className="flex justify-between items-start pointer-events-auto">
          <button onClick={onComplete} className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white">
            <X size={20} />
          </button>
          {error && (
            <div className="bg-red-500/90 text-white px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        {!capturedImage && (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-64 h-80 border-2 border-white/40 rounded-3xl relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-6 pointer-events-auto pb-24">
          {!isScanning && !capturedImage && (
            <div className="flex gap-4">
              <button
                onClick={startManualEntry}
                className="px-6 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors"
              >
                Manual Entry
              </button>
              <button
                onClick={triggerFileUpload}
                className="px-6 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-white text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors flex items-center gap-2"
              >
                <Upload size={14} />
                Upload Image
              </button>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            className="hidden"
          />

          {error && showManualPrompt && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/90 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-black/5 max-w-[280px] text-center space-y-3"
            >
              <p className="text-xs text-[#1A1A1A] font-medium">{error}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setCapturedImage(null); setError(null); setShowManualPrompt(false); }}
                  className="flex-1 py-2 bg-[#F5F5F0] text-[#5A5A40] rounded-xl text-[10px] font-bold uppercase tracking-wider"
                >
                  Retry Scan
                </button>
                <button
                  onClick={startManualEntry}
                  className="flex-1 py-2 bg-[#5A5A40] text-white rounded-xl text-[10px] font-bold uppercase tracking-wider"
                >
                  Manual Entry
                </button>
              </div>
            </motion.div>
          )}

          {isScanning ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={48} className="text-white animate-spin" />
              <p className="text-white text-xs font-bold uppercase tracking-widest">Analyzing Label...</p>
            </div>
          ) : (
            <button
              onClick={capturePhoto}
              disabled={!!capturedImage}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-white/20 backdrop-blur-sm active:scale-95 transition-transform"
            >
              <div className="w-16 h-16 rounded-full bg-white shadow-lg" />
            </button>
          )}
          <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest">Center the wine label in frame</p>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

const GERMAN_CITIES = [
  "Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Dusseldorf", "Leipzig", "Dortmund", "Essen",
  "Bremen", "Dresden", "Hanover", "Nuremberg", "Duisburg", "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Munster",
];

function BottleForm({
  initialData,
  onSave,
  onCancel,
  currentCoords,
}: {
  initialData: ScanResult;
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  currentCoords: { lat: number; lng: number } | null;
}) {
  const [formData, setFormData] = useState({
    brand: initialData.brand || "",
    producer: initialData.producer || "",
    year: initialData.year || new Date().getFullYear(),
    region: initialData.region || "",
    wine_type: initialData.wine_type || "",
    is_german: typeof initialData.is_german === "boolean" ? initialData.is_german : true,
    city: "GPS Location",
    score: 5,
    notes: "",
  });

  const handleFinalSave = () => {
    const finalData = { ...formData };
    if (formData.city === "GPS Location" && currentCoords) {
      onSave({ ...finalData, lat: currentCoords.lat, lng: currentCoords.lng, city: "Current Location" });
    } else {
      onSave(finalData);
    }
  };

  return (
    <div className="space-y-6">
      {!formData.is_german && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
          <AlertCircle className="text-amber-600 shrink-0" size={20} />
          <div>
            <p className="text-sm font-bold text-amber-800">Non-German Origin</p>
            <p className="text-xs text-amber-700">This app is optimized for tracking German wines. You can still log it, but it will not appear in regional production maps.</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#A1A19A] ml-2">Consumption Location</label>
          <select
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            className="w-full bg-white border border-black/5 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 appearance-none"
          >
            <option value="GPS Location">Current Location (GPS)</option>
            {GERMAN_CITIES.map((city) => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
        </div>

        <Input label="Brand / Wine Name" value={formData.brand} onChange={(v) => setFormData({ ...formData, brand: v })} />
        <Input label="Producer" value={formData.producer} onChange={(v) => setFormData({ ...formData, producer: v })} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Vintage" type="number" value={formData.year} onChange={(v) => setFormData({ ...formData, year: Number.parseInt(v || "0", 10) })} />
          <Input label="Region" value={formData.region} onChange={(v) => setFormData({ ...formData, region: v })} />
        </div>
        <Input label="Wine Type" value={formData.wine_type} onChange={(v) => setFormData({ ...formData, wine_type: v })} />

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#A1A19A]">Taste Score (1-10)</label>
          <div className="flex justify-between gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
              <button
                key={s}
                onClick={() => setFormData({ ...formData, score: s })}
                className={`flex-1 h-10 rounded-lg text-xs font-bold transition-all ${
                  formData.score === s ? "bg-[#5A5A40] text-white scale-110 shadow-md" : "bg-white text-[#A1A19A] border border-black/5"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#A1A19A]">Notes</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full bg-white border border-black/5 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 min-h-[100px]"
            placeholder="How did it taste?"
          />
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button onClick={onCancel} className="flex-1 py-4 rounded-2xl font-bold text-sm text-[#A1A19A] bg-white border border-black/5">Cancel</button>
        <button onClick={handleFinalSave} className="flex-1 py-4 rounded-2xl font-bold text-sm text-white bg-[#5A5A40] shadow-lg shadow-[#5A5A40]/20">Save Log</button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-widest text-[#A1A19A] ml-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-black/5 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
      />
    </div>
  );
}
