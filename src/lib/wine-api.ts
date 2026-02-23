import { supabase } from "@/integrations/supabase/client";

// ── Analysis mode ─────────────────────────────────────────────────────

export type AnalysisMode = "analyzer" | "recognition_explorer";

const STORAGE_KEY = "wine_analysis_mode";

export function getStoredMode(): AnalysisMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "analyzer" || stored === "recognition_explorer") return stored;
  } catch {}
  return "analyzer";
}

export function setStoredMode(mode: AnalysisMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {}
}

// ── Normalized response shape ─────────────────────────────────────────

export interface NormalizedWineResult {
  mode: AnalysisMode;
  wine: {
    full_name: string | null;
    producer: string | null;
    winery: string | null;
    winery_description: string | null;
    region_name: string | null;
    country: string | null;
    wine_type: string | null;
    vintage: string | null;
    grape_variety: string | null;
    average_price_usd: number | null;
  };
  sensory: {
    aroma: string | null;
    tasting_notes: string | null;
    food_pairing: string | null;
  };
  serving: {
    temp_min_c: number | null;
    temp_max_c: number | null;
    decanting_minutes: number | null;
  };
  ratings: {
    avg_rating: number | null;
    reviews: number | null;
    source: string | null;
  };
  debug: {
    confidence: number | null;
    selected_id: string | null;
    errors: string[];
    raw?: unknown;
  };
}

// ── API calls ─────────────────────────────────────────────────────────

export async function analyzeWine(
  file: File,
  mode: AnalysisMode = "analyzer",
  lang: string = "en",
): Promise<NormalizedWineResult> {
  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("lang", lang);

  const { data, error } = await supabase.functions.invoke(
    `recognize-wine?${params.toString()}`,
    { body: formData },
  );

  if (error) throw new Error(error.message || "Analysis failed");
  if (data?.error) throw new Error(data.error);
  return data as NormalizedWineResult;
}
