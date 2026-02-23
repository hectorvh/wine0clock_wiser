import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANALYZER_HOST = "wine-analyzer.p.rapidapi.com";
const ANALYZER_BASE = `https://${ANALYZER_HOST}`;
const TIMEOUT_MS = 15_000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

// ── Normalized response shape ──────────────────────────────────────────

interface NormalizedWineResponse {
  mode: "analyzer";
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

function normalizeAnalyzerResult(raw: any): NormalizedWineResponse {
  const r = raw?.results?.[0] ?? raw ?? {};
  const temp = r.serving_temperature_celcius_range ?? r.serving_temperature_celsius_range ?? {};

  return {
    mode: "analyzer",
    wine: {
      full_name: r.full_wine_name ?? null,
      producer: r.winery ?? null,
      winery: r.winery ?? null,
      winery_description: r.winery_description ?? null,
      region_name: r.region ?? null,
      country: r.country ?? null,
      wine_type: r.wine_type ?? null,
      vintage: r.vintage ?? null,
      grape_variety: r.grape_variety ?? null,
      average_price_usd: r.average_retail_price_usd ?? null,
    },
    sensory: {
      aroma: r.aroma ?? null,
      tasting_notes: r.tasting_notes ?? null,
      food_pairing: r.food_pairing ?? null,
    },
    serving: {
      temp_min_c: temp?.min_temp ?? null,
      temp_max_c: temp?.max_temp ?? null,
      decanting_minutes: r.decanting_time_minutes ?? null,
    },
    ratings: {
      avg_rating: null,
      reviews: null,
      source: null,
    },
    debug: {
      confidence: null,
      selected_id: raw?.id ?? null,
      errors: [],
    },
  };
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rapidApiKey = Deno.env.get("RAPIDAPI_KEY");
  if (!rapidApiKey) {
    return makeError(500, "RapidAPI key not configured");
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "analyze";
  const lang = url.searchParams.get("lang") ?? "en";
  const includeRaw = url.searchParams.get("include_raw") === "true";

  try {
    // ── POST /analyze (image upload) ───────────────────────────────
    if (req.method === "POST" && action === "analyze") {
      const contentType = req.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return makeError(400, "Content-Type must be multipart/form-data");
      }

      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return makeError(400, "No file provided. Send a file in the 'file' field.");
      }
      if (file.size > MAX_FILE_SIZE) {
        return makeError(400, "File too large. Maximum size is 10MB.");
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        return makeError(400, `Invalid file type '${file.type}'.`);
      }

      // Build multipart for Wine Analyzer API
      const apiForm = new FormData();
      apiForm.append("files", file, file.name);
      apiForm.append("lang", lang);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let apiRes: Response;
      let retries = 1;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          apiRes = await fetch(`${ANALYZER_BASE}/api/analyze`, {
            method: "POST",
            headers: {
              "X-RapidAPI-Key": rapidApiKey,
              "X-RapidAPI-Host": ANALYZER_HOST,
            },
            body: apiForm,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (apiRes!.ok || attempt === retries) break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt === retries) {
            clearTimeout(timeout);
            throw lastError;
          }
        }
      }

      const data = await apiRes!.json();

      if (!apiRes!.ok) {
        const errMsg = data?.error || `Wine Analyzer returned ${apiRes!.status}`;
        // Return partial response, don't break
        const partial = normalizeAnalyzerResult({});
        partial.debug.errors.push(errMsg);
        return makeResponse(partial);
      }

      const normalized = normalizeAnalyzerResult(data);
      if (includeRaw) {
        normalized.debug.raw = data;
      }

      return makeResponse(normalized);
    }

    // ── POST /search (text search) ────────────────────────────────
    if (req.method === "POST" && action === "search") {
      const body = await req.json();
      const query = body?.query;
      if (!query || typeof query !== "string") {
        return makeError(400, "query string required in body");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const apiRes = await fetch(`${ANALYZER_BASE}/api/search`, {
        method: "POST",
        headers: {
          "X-RapidAPI-Key": rapidApiKey,
          "X-RapidAPI-Host": ANALYZER_HOST,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, lang: body.lang ?? "en" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await apiRes.json();

      if (!apiRes.ok) {
        return makeError(502, data?.error || `Wine Analyzer search returned ${apiRes.status}`);
      }

      // Normalize each search result
      const results = (data?.results?.query ?? []).map((r: any) => normalizeAnalyzerResult({ results: [r] }));
      return makeResponse({ mode: "analyzer", results });
    }

    return makeError(400, `Unknown action '${action}'. Use 'analyze' or 'search'.`);
  } catch (err) {
    console.error("Wine Analyzer error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const partial = normalizeAnalyzerResult({});
    partial.debug.errors.push(message);
    return makeResponse(partial);
  }
});
