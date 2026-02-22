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
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

// ── Types ──────────────────────────────────────────────────────────────

interface WineCandidate {
  label: string;
  confidence: number;
}

interface EnrichmentResult {
  enrichment_status: "matched" | "no_match" | "skipped" | "error";
  explorer?: {
    search_candidates: Array<{ _id: string; name: string }>;
    selected?: { _id: string; name: string; score: number };
    info?: Record<string, unknown>;
  };
  error_reason?: string;
}

interface RecognitionResponse {
  request_id: string;
  top_candidates: WineCandidate[];
  raw_response?: unknown;
  enrichment?: EnrichmentResult;
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseTopK(url: URL): number {
  const raw = url.searchParams.get("top_k");
  const topK = raw ? parseInt(raw, 10) : 5;
  return Math.min(Math.max(topK, 1), 10);
}

function shouldIncludeRaw(url: URL): boolean {
  return url.searchParams.get("include_raw") === "true";
}

function shouldEnrich(url: URL): boolean {
  return url.searchParams.get("enrich") === "true";
}

function getMinConfidence(url: URL): number {
  const raw = url.searchParams.get("min_confidence");
  return raw ? parseFloat(raw) : 0.6;
}

// ── Recognition API parsing ────────────────────────────────────────────

function parseCandidates(apiResponse: any): WineCandidate[] {
  try {
    const results = apiResponse?.results ?? [];
    const candidates: WineCandidate[] = [];

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

async function callRecognitionAPI(
  body: FormData | string,
  isUrl: boolean,
  rapidApiKey: string,
): Promise<{ apiResponse: any; status: number }> {
  const headers: Record<string, string> = {
    "X-RapidAPI-Key": rapidApiKey,
    "X-RapidAPI-Host": RAPIDAPI_HOST,
  };

  if (isUrl) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(RAPIDAPI_URL, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json();
    return { apiResponse: data, status: response.status };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("RapidAPI request timed out");
    }
    throw err;
  }
}

// ── Enrichment (calls wine-explorer) ───────────────────────────────────

function bigrams(s: string): Set<string> {
  const lower = s.toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i < lower.length - 1; i++) {
    set.add(lower.slice(i, i + 2));
  }
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

async function fetchWithTimeout(url: string, options: RequestInit, ms = 10000): Promise<Response> {
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

async function enrichFromRecognition(
  wineName: string,
  apiKey: string,
): Promise<EnrichmentResult> {
  try {
    const searchUrl = `${EXPLORER_BASE}/api/wines/search?query=${encodeURIComponent(wineName)}`;
    const searchRes = await fetchWithTimeout(searchUrl, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": EXPLORER_HOST,
      },
    });

    if (!searchRes.ok) {
      return { enrichment_status: "error", error_reason: `Search returned ${searchRes.status}` };
    }

    const searchData = await searchRes.json();
    const candidates: Array<{ _id: string; name: string; [k: string]: unknown }> =
      Array.isArray(searchData) ? searchData : (searchData?.results ?? searchData?.wines ?? []);

    if (candidates.length === 0) {
      return { enrichment_status: "no_match", explorer: { search_candidates: [] } };
    }

    // Score candidates
    const scored = candidates.slice(0, 10).map((c) => ({
      ...c,
      score: diceSimilarity(wineName, c.name || ""),
    })).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const THRESHOLD = 0.3;

    const topCandidates = scored.slice(0, 5).map((c) => ({ _id: c._id, name: c.name }));

    if (!best || best.score < THRESHOLD) {
      return { enrichment_status: "no_match", explorer: { search_candidates: topCandidates } };
    }

    // Get details
    try {
      const infoUrl = `${EXPLORER_BASE}/api/wines/${encodeURIComponent(best._id)}`;
      const infoRes = await fetchWithTimeout(infoUrl, {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": EXPLORER_HOST,
        },
      });

      if (!infoRes.ok) {
        return {
          enrichment_status: "matched",
          explorer: {
            search_candidates: topCandidates,
            selected: { _id: best._id, name: best.name, score: best.score },
          },
          error_reason: "Info lookup failed",
        };
      }

      const info = await infoRes.json();
      return {
        enrichment_status: "matched",
        explorer: {
          search_candidates: topCandidates,
          selected: { _id: best._id, name: best.name, score: best.score },
          info,
        },
      };
    } catch {
      return {
        enrichment_status: "matched",
        explorer: {
          search_candidates: topCandidates,
          selected: { _id: best._id, name: best.name, score: best.score },
        },
        error_reason: "Info lookup timed out",
      };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown enrichment error";
    return { enrichment_status: "error", error_reason: reason };
  }
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rapidApiKey = Deno.env.get("RAPIDAPI_KEY");
  if (!rapidApiKey) {
    return makeErrorResponse(500, "RapidAPI key not configured");
  }

  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const url = new URL(req.url);
  const topK = parseTopK(url);
  const includeRaw = shouldIncludeRaw(url);
  const enrich = shouldEnrich(url);
  const minConfidence = getMinConfidence(url);

  try {
    let apiResponse: any;
    let apiStatus: number;
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return makeErrorResponse(400, "No file provided. Send a file in the 'file' field.");
      }
      if (file.size > MAX_FILE_SIZE) {
        return makeErrorResponse(400, `File too large. Maximum size is 10MB.`);
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        return makeErrorResponse(400, `Invalid file type '${file.type}'.`);
      }

      console.log(`[${requestId}] Processing file: ${file.name}, size: ${file.size}`);
      const apiFormData = new FormData();
      apiFormData.append("image", file);
      const result = await callRecognitionAPI(apiFormData, false, rapidApiKey);
      apiResponse = result.apiResponse;
      apiStatus = result.status;
    } else {
      const body = await req.json();
      const imageUrl = body?.url;

      if (!imageUrl || typeof imageUrl !== "string") {
        return makeErrorResponse(400, "No URL provided.");
      }
      try { new URL(imageUrl); } catch { return makeErrorResponse(400, "Invalid URL format."); }

      console.log(`[${requestId}] Processing URL: ${imageUrl}`);
      const result = await callRecognitionAPI(JSON.stringify({ url: imageUrl }), true, rapidApiKey);
      apiResponse = result.apiResponse;
      apiStatus = result.status;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[${requestId}] Recognition: status ${apiStatus} in ${elapsed}ms`);

    if (apiStatus !== 200) {
      return makeErrorResponse(502, `Wine recognition service returned status ${apiStatus}`);
    }

    const allCandidates = parseCandidates(apiResponse);
    const topCandidates = allCandidates.slice(0, topK);

    const response: RecognitionResponse = {
      request_id: requestId,
      top_candidates: topCandidates,
    };

    if (includeRaw) {
      response.raw_response = apiResponse;
    }

    // ── Optional enrichment ──────────────────────────────────────────
    if (enrich) {
      const topCandidate = topCandidates[0];
      if (topCandidate && topCandidate.confidence >= minConfidence) {
        console.log(`[${requestId}] Enriching: "${topCandidate.label}" (conf: ${topCandidate.confidence})`);
        response.enrichment = await enrichFromRecognition(topCandidate.label, rapidApiKey);
      } else {
        response.enrichment = { enrichment_status: "skipped" };
      }
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[${requestId}] Error after ${elapsed}ms:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return makeErrorResponse(500, `Recognition failed: ${message}`);
  }
});
