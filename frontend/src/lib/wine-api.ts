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

/** Full response shape for JSON log: all NormalizedWineResult fields guaranteed. */
function responseForLog(data: unknown): NormalizedWineResult | null {
  if (data == null || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const wine = (d.wine as Record<string, unknown>) ?? {};
  const sensory = (d.sensory as Record<string, unknown>) ?? {};
  const serving = (d.serving as Record<string, unknown>) ?? {};
  const ratings = (d.ratings as Record<string, unknown>) ?? {};
  const debug = (d.debug as Record<string, unknown>) ?? {};
  return {
    mode: (d.mode as AnalysisMode) ?? "analyzer",
    wine: {
      full_name: (wine.full_name as string | null) ?? null,
      producer: (wine.producer as string | null) ?? null,
      winery: (wine.winery as string | null) ?? null,
      winery_description: (wine.winery_description as string | null) ?? null,
      region_name: (wine.region_name as string | null) ?? null,
      country: (wine.country as string | null) ?? null,
      wine_type: (wine.wine_type as string | null) ?? null,
      vintage: (wine.vintage as string | null) ?? null,
      grape_variety: (wine.grape_variety as string | null) ?? null,
      average_price_usd: (wine.average_price_usd as number | null) ?? null,
    },
    sensory: {
      aroma: (sensory.aroma as string | null) ?? null,
      tasting_notes: (sensory.tasting_notes as string | null) ?? null,
      food_pairing: (sensory.food_pairing as string | null) ?? null,
    },
    serving: {
      temp_min_c: (serving.temp_min_c as number | null) ?? null,
      temp_max_c: (serving.temp_max_c as number | null) ?? null,
      decanting_minutes: (serving.decanting_minutes as number | null) ?? null,
    },
    ratings: {
      avg_rating: (ratings.avg_rating as number | null) ?? null,
      reviews: (ratings.reviews as number | null) ?? null,
      source: (ratings.source as string | null) ?? null,
    },
    debug: {
      confidence: (debug.confidence as number | null) ?? null,
      selected_id: (debug.selected_id as string | null) ?? null,
      errors: Array.isArray(debug.errors) ? (debug.errors as string[]) : [],
      raw: debug.raw,
    },
  };
}

// ── Example result (all features) ─────────────────────────────────────

export const EXAMPLE_WINE_RESULT: NormalizedWineResult = {
  mode: "analyzer",
  wine: {
    full_name: "Example Primitivo",
    producer: null,
    winery: null,
    winery_description: null,
    region_name: "Puglia",
    country: null,
    wine_type: null,
    vintage: null,
    grape_variety: "Primitivo",
    average_price_usd: 15,
  },
  sensory: {
    aroma: "fruity floral notes",
    tasting_notes: "smooth fruity taste",
    food_pairing: "meat pasta",
  },
  serving: {
    temp_min_c: 15,
    temp_max_c: 18,
    decanting_minutes: 30,
  },
  ratings: {
    avg_rating: null,
    reviews: null,
    source: null,
  },
  debug: {
    confidence: 1,
    selected_id: null,
    errors: [],
  },
};

// ── API calls ─────────────────────────────────────────────────────────

const DEV_LOG_POST = "/__log-post";
const MAX_FILE_BASE64_LOG = 500_000; // only embed file in log if ≤ 500KB

async function logPostInDev(endpoint: string, payload: unknown): Promise<void> {
  if (import.meta.env.DEV && typeof fetch === "function") {
    try {
      await fetch(DEV_LOG_POST, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, payload }),
      });
    } catch {
      // ignore (e.g. dev server not running or logger not available)
    }
  }
}

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

  const requestLog: Record<string, unknown> = {
    query: { mode, lang },
    file: {
      name: file.name,
      size: file.size,
      type: file.type,
    },
  };
  if (file.size <= MAX_FILE_BASE64_LOG) {
    try {
      requestLog.file_base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    } catch {
      // omit base64 on read error
    }
  }

  const { data, error } = await supabase.functions.invoke(
    `recognize-wine?${params.toString()}`,
    { body: formData },
  );

  await logPostInDev("recognize-wine", {
    request: requestLog,
    response: responseForLog(data),
    error: error ? { message: error.message } : data?.error ? { message: data.error } : undefined,
  });

  if (error) throw new Error(error.message || "Analysis failed");
  if (data?.error) throw new Error(data.error);
  return data as NormalizedWineResult;
}
