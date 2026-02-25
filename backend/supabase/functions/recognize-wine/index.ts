import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RAPIDAPI_HOST = "wine-recognition2.p.rapidapi.com";
const RAPIDAPI_URL = `https://${RAPIDAPI_HOST}/v1/results`;
const EXPLORER_HOST = "wine-explorer-api-ratings-insights-and-search.p.rapidapi.com";
const EXPLORER_BASE = `https://${EXPLORER_HOST}`;
const ANALYZER_HOST = "wine-analyzer.p.rapidapi.com";
const ANALYZER_BASE = `https://${ANALYZER_HOST}`;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

// WFS wine regions (dlm1000, veg 1040 = wine)
const WFS_URL = "https://sgx.geodatenzentrum.de/wfs_dlm1000";
const WFS_LAYER = "dlm1000:objart_43001_f";
const WFS_TIMEOUT_MS = 15_000;

type AnalysisMode = "analyzer" | "recognition_explorer";

// GeoJSON FeatureCollection for region geometry
interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{ type: "Feature"; id?: string; geometry: unknown; properties?: Record<string, unknown> }>;
}

// ── Normalized response (shared between both pipelines) ───────────────

interface NormalizedResponse {
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
  /** GeoJSON FeatureCollection for wine region geometry (WFS, veg 1040). Always present; features may be empty. */
  region_geojson: GeoJSONFeatureCollection;
}

const EMPTY_GEOJSON: GeoJSONFeatureCollection = { type: "FeatureCollection", features: [] };

function emptyResponse(mode: AnalysisMode): NormalizedResponse {
  return {
    mode,
    wine: { full_name: null, producer: null, winery: null, winery_description: null, region_name: null, country: null, wine_type: null, vintage: null, grape_variety: null, average_price_usd: null },
    sensory: { aroma: null, tasting_notes: null, food_pairing: null },
    serving: { temp_min_c: null, temp_max_c: null, decanting_minutes: null },
    ratings: { avg_rating: null, reviews: null, source: null },
    debug: { confidence: null, selected_id: null, errors: [] },
    region_geojson: EMPTY_GEOJSON,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function makeError(status: number, message: string): Response {
  return makeResponse({ error: message }, status);
}

async function fetchWithTimeout(url: string, options: RequestInit, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ── WFS wine regions (dlm1000, veg 1040) ─────────────────────────────

/**
 * Fetches wine region features from WFS. Filters veg === "1040" (wine).
 * If regionName is provided, filters features where properties.nam matches (case-insensitive, or contains).
 * Requests srsName=EPSG:4326 so geometry is WGS84 (lon/lat), like ST_AsGeoJSON(ST_Transform(geom, 4326)).
 * Returns a GeoJSON FeatureCollection.
 */
async function fetchWineRegionsGeoJSON(regionName: string | null): Promise<GeoJSONFeatureCollection | null> {
  if (!regionName || !regionName.trim()) return null;
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typename: WFS_LAYER,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  const url = `${WFS_URL}?${params.toString()}`;
  try {
    const res = await fetchWithTimeout(url, { method: "GET" }, WFS_TIMEOUT_MS);
    if (!res.ok) return null;
    const geojson = await res.json();
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const wineFeatures = features.filter((f: any) => f?.properties?.veg === "1040");
    const nameNorm = regionName.trim().toLowerCase();
    const filtered = nameNorm
      ? wineFeatures.filter((f: any) => {
          const nam = f?.properties?.nam;
          if (nam == null) return false;
          const n = String(nam).trim().toLowerCase();
          return n === nameNorm || n.includes(nameNorm) || nameNorm.includes(n);
        })
      : wineFeatures;
    return { type: "FeatureCollection", features: filtered };
  } catch {
    return null;
  }
}

// ── Pipeline A: Recognition + Explorer ────────────────────────────────

function parseCandidates(apiResponse: any): Array<{ label: string; confidence: number }> {
  try {
    const results = apiResponse?.results ?? [];
    const candidates: Array<{ label: string; confidence: number }> = [];
    for (const result of results) {
      const entities = result?.entities ?? [];
      for (const entity of entities) {
        const classes = entity?.classes ?? {};
        for (const [label, confidence] of Object.entries(classes)) {
          candidates.push({ label, confidence: confidence as number });
        }
        if (entity?.array) {
          for (const item of entity.array) {
            if (item?.name && item?.confidence != null) {
              candidates.push({ label: item.name, confidence: item.confidence });
            }
          }
        }
      }
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  } catch {
    return [];
  }
}

function bigrams(s: string): Set<string> {
  const lower = s.toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i < lower.length - 1; i++) set.add(lower.slice(i, i + 2));
  return set;
}

function diceSimilarity(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 && bb.size === 0) return 1;
  let overlap = 0;
  for (const g of ba) if (bb.has(g)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

async function pipelineRecognitionExplorer(
  file: File,
  rapidApiKey: string,
  includeRaw: boolean,
): Promise<NormalizedResponse> {
  const result = emptyResponse("recognition_explorer");
  const errors: string[] = [];

  // Step A1: Recognition
  const apiFormData = new FormData();
  apiFormData.append("image", file);

  let recognitionData: any;
  try {
    const res = await fetchWithTimeout(RAPIDAPI_URL, {
      method: "POST",
      headers: { "X-RapidAPI-Key": rapidApiKey, "X-RapidAPI-Host": RAPIDAPI_HOST },
      body: apiFormData,
    });

    if (!res.ok) {
      if (res.status === 429) {
        errors.push("Rate limit exceeded on recognition API. Please try again shortly.");
        result.debug.errors = errors;
        return result;
      }
      errors.push(`Recognition API returned ${res.status}`);
      result.debug.errors = errors;
      return result;
    }

    recognitionData = await res.json();
  } catch (err) {
    errors.push(`Recognition failed: ${err instanceof Error ? err.message : "timeout"}`);
    result.debug.errors = errors;
    return result;
  }

  const candidates = parseCandidates(recognitionData);
  if (candidates.length === 0) {
    errors.push("No wine labels detected in image");
    result.debug.errors = errors;
    if (includeRaw) result.debug.raw = recognitionData;
    return result;
  }

  const top = candidates[0];
  result.wine.full_name = top.label;
  result.debug.confidence = top.confidence;
  if (includeRaw) result.debug.raw = recognitionData;

  // Step A2: Wine Explorer enrichment (best-effort)
  if (top.confidence < 0.3) {
    errors.push("Confidence too low for enrichment");
    result.debug.errors = errors;
    return result;
  }

  try {
    const searchUrl = `${EXPLORER_BASE}/api/wines/search?query=${encodeURIComponent(top.label)}`;
    const searchRes = await fetchWithTimeout(searchUrl, {
      method: "GET",
      headers: { "X-RapidAPI-Key": rapidApiKey, "X-RapidAPI-Host": EXPLORER_HOST },
    }, 10000);

    if (!searchRes.ok) {
      errors.push(`Explorer search returned ${searchRes.status}`);
      result.debug.errors = errors;
      return result;
    }

    const searchData = await searchRes.json();
    const explorerCandidates = Array.isArray(searchData) ? searchData : (searchData?.results ?? searchData?.wines ?? []);

    if (explorerCandidates.length === 0) {
      errors.push("No matches in Wine Explorer database");
      result.debug.errors = errors;
      return result;
    }

    // Score and pick best
    const scored = explorerCandidates.slice(0, 10).map((c: any) => ({
      ...c,
      score: diceSimilarity(top.label, c.name || ""),
    })).sort((a: any, b: any) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 0.3) {
      errors.push("No close match found in Wine Explorer");
      result.debug.errors = errors;
      return result;
    }

    result.debug.selected_id = best._id;

    // Get info
    try {
      const infoUrl = `${EXPLORER_BASE}/api/wines/${encodeURIComponent(best._id)}`;
      const infoRes = await fetchWithTimeout(infoUrl, {
        method: "GET",
        headers: { "X-RapidAPI-Key": rapidApiKey, "X-RapidAPI-Host": EXPLORER_HOST },
      }, 10000);

      if (infoRes.ok) {
        const info = await infoRes.json();
        result.wine.winery = info.winery?.name ?? null;
        result.wine.region_name = info.region ?? info.winery?.region ?? null;
        result.ratings.source = "wine_explorer";

        const stats = info.statistics ?? {};
        result.ratings.avg_rating = stats.ratings_average ?? stats.average_rating ?? null;
        result.ratings.reviews = stats.ratings_count ?? stats.total_ratings ?? null;

        if (info.vintages?.length > 0) {
          const years = info.vintages.map((v: any) => v.year).filter(Boolean).sort((a: number, b: number) => b - a);
          if (years.length > 0) result.wine.vintage = String(years[0]);
        }
      } else {
        errors.push("Wine Explorer info lookup failed");
      }
    } catch {
      errors.push("Wine Explorer info timed out");
    }
  } catch (err) {
    errors.push(`Explorer enrichment failed: ${err instanceof Error ? err.message : "unknown"}`);
  }

  result.debug.errors = errors;
  return result;
}

// ── Pipeline B: Wine Analyzer ─────────────────────────────────────────

async function pipelineAnalyzer(
  file: File,
  rapidApiKey: string,
  lang: string,
  includeRaw: boolean,
): Promise<NormalizedResponse> {
  const result = emptyResponse("analyzer");

  const apiForm = new FormData();
  apiForm.append("files", file, file.name);
  apiForm.append("lang", lang);

  try {
    const res = await fetchWithTimeout(`${ANALYZER_BASE}/api/analyze`, {
      method: "POST",
      headers: { "X-RapidAPI-Key": rapidApiKey, "X-RapidAPI-Host": ANALYZER_HOST },
      body: apiForm,
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 429) {
        result.debug.errors.push("Rate limit exceeded. Please try again shortly.");
        return result;
      }
      result.debug.errors.push(data?.error || `Wine Analyzer returned ${res.status}`);
      return result;
    }

    const r = data?.results?.[0] ?? data ?? {};
    const temp = r.serving_temperature_celcius_range ?? r.serving_temperature_celsius_range ?? {};

    result.wine.full_name = r.full_wine_name ?? null;
    result.wine.producer = r.winery ?? null;
    result.wine.winery = r.winery ?? null;
    result.wine.winery_description = r.winery_description ?? null;
    result.wine.region_name = r.region ?? null;
    result.wine.wine_type = r.wine_type ?? null;
    result.wine.vintage = r.vintage ?? null;
    result.wine.grape_variety = r.grape_variety ?? null;
    result.wine.average_price_usd = r.average_retail_price_usd ?? null;
    result.sensory.aroma = r.aroma ?? null;
    result.sensory.tasting_notes = r.tasting_notes ?? null;
    result.sensory.food_pairing = r.food_pairing ?? null;
    result.serving.temp_min_c = temp?.min_temp ?? null;
    result.serving.temp_max_c = temp?.max_temp ?? null;
    result.serving.decanting_minutes = r.decanting_time_minutes ?? null;
    result.debug.selected_id = data?.id ?? null;

    if (includeRaw) result.debug.raw = data;
  } catch (err) {
    result.debug.errors.push(`Analyzer failed: ${err instanceof Error ? err.message : "timeout"}`);
  }

  return result;
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rapidApiKey = Deno.env.get("RAPIDAPI_KEY");
  if (!rapidApiKey) return makeError(500, "RapidAPI key not configured");

  if (req.method !== "POST") return makeError(405, "POST only");

  const url = new URL(req.url);
  const mode: AnalysisMode = (url.searchParams.get("mode") as AnalysisMode) || "analyzer";
  const includeRaw = url.searchParams.get("include_raw") === "true";
  const lang = url.searchParams.get("lang") ?? "en";

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return makeError(400, "Content-Type must be multipart/form-data");
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return makeError(400, "No file provided. Send a file in the 'file' field.");
  }
  if (file.size > MAX_FILE_SIZE) return makeError(400, "File too large. Maximum 10MB.");
  if (!ALLOWED_TYPES.includes(file.type)) return makeError(400, `Invalid file type '${file.type}'.`);

  console.log(`[recognize-wine] mode=${mode}, file=${file.name}, size=${file.size}`);

  let result: NormalizedResponse;

  if (mode === "recognition_explorer") {
    result = await pipelineRecognitionExplorer(file, rapidApiKey, includeRaw);
  } else {
    result = await pipelineAnalyzer(file, rapidApiKey, lang, includeRaw);
  }

  // Attach WFS GeoJSON for wine region (same format as fetchWineRegions / wfs_test: FeatureCollection with geometry).
  // Always return a FeatureCollection so GeoJSON files can be generated even when geometry is empty or WFS has no response.
  const regionGeo = await fetchWineRegionsGeoJSON(result.wine.region_name);
  result.region_geojson = regionGeo ?? EMPTY_GEOJSON;

  return makeResponse(result);
});
