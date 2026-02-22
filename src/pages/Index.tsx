import { useState, useCallback } from "react";
import { Camera, Upload, Wine, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/CameraCapture";
import { ImageUpload } from "@/components/ImageUpload";
import { WineResults } from "@/components/WineResults";
import { WineEnrichment } from "@/components/WineEnrichment";
import { recognizeWineByFile, type RecognitionResult } from "@/lib/wine-api";
import heroBg from "@/assets/hero-bg.jpg";

type Mode = "idle" | "camera" | "upload";

const Index = () => {
  const [mode, setMode] = useState<Mode>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setMode("idle");
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await recognizeWineByFile(file, 5, false, true);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recognition failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    setMode("idle");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />

        <div className="relative z-10 flex flex-col items-center justify-center px-6 pt-20 pb-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 backdrop-blur-lg flex items-center justify-center mb-6 glow-primary">
            <Wine className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-gradient-wine mb-3">
            Sommelier AI
          </h1>
          <p className="text-muted-foreground max-w-md text-lg">
            Snap or upload a wine label and instantly identify the bottle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-lg mx-auto px-6 pb-16 -mt-4 space-y-6">
        {/* Action Buttons (when idle and no preview) */}
        {mode === "idle" && !preview && !loading && (
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => setMode("camera")}
              className="h-14 text-base gap-2 glow-primary"
              size="lg"
            >
              <Camera className="h-5 w-5" />
              Take Photo
            </Button>
            <Button
              onClick={() => setMode("upload")}
              variant="secondary"
              className="h-14 text-base gap-2"
              size="lg"
            >
              <Upload className="h-5 w-5" />
              Upload
            </Button>
          </div>
        )}

        {/* Camera Mode */}
        {mode === "camera" && (
          <CameraCapture
            onCapture={processFile}
            onClose={() => setMode("idle")}
          />
        )}

        {/* Upload Mode */}
        {mode === "upload" && (
          <div className="space-y-3">
            <ImageUpload onFileSelected={processFile} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("idle")}
              className="w-full text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Preview Image */}
        {preview && (
          <div className="glass-card rounded-xl overflow-hidden">
            <img
              src={preview}
              alt="Wine label preview"
              className="w-full max-h-72 object-contain bg-muted/20"
            />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="glass-card rounded-xl p-8 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Analyzing wine label…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="glass-card rounded-xl p-6 border-destructive/30 text-center">
            <p className="text-sm text-destructive mb-3">{error}</p>
            <Button variant="secondary" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4 mr-2" /> Try Again
            </Button>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            <WineResults
              candidates={result.top_candidates}
              requestId={result.request_id}
            />
            {result.enrichment && (
              <WineEnrichment enrichment={result.enrichment} />
            )}
            <Button
              onClick={reset}
              variant="secondary"
              className="w-full"
            >
              <RotateCcw className="h-4 w-4 mr-2" /> Scan Another
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default Index;
