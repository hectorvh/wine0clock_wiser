import { useState, useCallback } from "react";
import { Camera, Upload, Wine, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CameraCapture } from "@/components/CameraCapture";
import { ImageUpload } from "@/components/ImageUpload";
import { UnifiedWineResults } from "@/components/UnifiedWineResults";
import { AnalysisModeToggle } from "@/components/AnalysisModeToggle";
import {
  analyzeWine,
  getStoredMode,
  setStoredMode,
  EXAMPLE_WINE_RESULT,
  type AnalysisMode,
  type NormalizedWineResult,
} from "@/lib/wine-api";
import heroBg from "@/assets/hero-bg.jpg";

type UIMode = "idle" | "camera" | "upload";

const Index = () => {
  const [uiMode, setUiMode] = useState<UIMode>("idle");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(getStoredMode);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NormalizedWineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleModeChange = (mode: AnalysisMode) => {
    setAnalysisMode(mode);
    setStoredMode(mode);
  };

  const processFile = useCallback(
    async (file: File) => {
      setPreview(URL.createObjectURL(file));
      setUiMode("idle");
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await analyzeWine(file, analysisMode);
        setResult(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Analysis failed");
      } finally {
        setLoading(false);
      }
    },
    [analysisMode],
  );

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    setUiMode("idle");
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
            Wine O'Clock Wiser
          </h1>
          <p className="text-muted-foreground max-w-md text-lg">
            Snap or upload a wine label and instantly identify the bottle
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto px-6 pb-8 space-y-4">
        {/* Analysis Mode Toggle */}
        {uiMode === "idle" && !loading && (
          <AnalysisModeToggle mode={analysisMode} onChange={handleModeChange} />
        )}

        {/* Action Buttons */}
        {uiMode === "idle" && !preview && !loading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => setUiMode("camera")}
                className="h-14 text-base gap-2 glow-primary"
                size="lg"
              >
                <Camera className="h-5 w-5" />
                Take Photo
              </Button>
              <Button
                onClick={() => setUiMode("upload")}
                variant="secondary"
                className="h-14 text-base gap-2"
                size="lg"
              >
                <Upload className="h-5 w-5" />
                Upload
              </Button>
            </div>
            <Button
              onClick={() => setResult(EXAMPLE_WINE_RESULT)}
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
            >
              See example (all features)
            <Button
              onClick={() => setUiMode("upload")}
              variant="secondary"
              className="h-14 text-base gap-2"
              size="lg"
            >
              <Upload className="h-5 w-5" />
              Upload
            </Button>
            </Button>
          </div>
        )}

        {/* Camera Mode */}
        {uiMode === "camera" && (
          <CameraCapture
            onCapture={processFile}
            onClose={() => setUiMode("idle")}
          />
        )}

        {/* Upload Mode */}
        {uiMode === "upload" && (
          <div className="space-y-3">
            <ImageUpload onFileSelected={processFile} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUiMode("idle")}
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
            <p className="text-sm text-muted-foreground">
              {analysisMode === "analyzer" ? "Analyzing wine label…" : "Recognizing wine…"}
            </p>
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
            <UnifiedWineResults result={result} />
            <Button onClick={reset} variant="secondary" className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" /> Scan Another
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default Index;
