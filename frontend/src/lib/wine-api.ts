import { createClient } from "@supabase/supabase-js";

export type AnalysisMode = "analyzer" | "recognition_explorer";

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
  region_geojson?: { type: "FeatureCollection"; features: unknown[] } | null;
}

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
);

const DEV_LOG_POST_URL =
  (import.meta.env.VITE_LOG_POST_URL as string) || "http://localhost:3001/log-post";

const MAX_FILE_BASE64_LOG = 500_000;

async function fileToBase64(file: File): Promise<string | null> {
  if (file.size > MAX_FILE_BASE64_LOG) return null;
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function logPostInDev(endpoint: string, payload: unknown): Promise<void> {
  if (!import.meta.env.DEV) return;
  try {
    await fetch(DEV_LOG_POST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, payload }),
    });
  } catch {
    // silent in dev when log server is off
  }
}

export async function analyzeWine(
  file: File,
  mode: AnalysisMode = "analyzer",
  lang: string = "en",
): Promise<NormalizedWineResult> {
  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams({ mode, lang });
  const { data, error } = await supabase.functions.invoke(
    `recognize-wine?${params.toString()}`,
    { body: formData },
  );

  await logPostInDev("recognize-wine", {
    request: {
      query: { mode, lang },
      file: { name: file.name, size: file.size, type: file.type },
      file_base64: await fileToBase64(file),
    },
    response: data ?? null,
    error: error ? { message: error.message } : data?.error ? { message: data.error } : undefined,
  });

  if (error) throw new Error(error.message || "Analysis failed");
  if (data?.error) throw new Error(data.error);
  return data as NormalizedWineResult;
}
