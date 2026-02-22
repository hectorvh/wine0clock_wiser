import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXPLORER_HOST = "wine-explorer-api-ratings-insights-and-search.p.rapidapi.com";
const EXPLORER_BASE = `https://${EXPLORER_HOST}`;
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 1;

// ── Types ──────────────────────────────────────────────────────────────

interface WineSearchCandidate {
  _id: string;
  name: string;
  [key: string]: unknown;
}

interface WineExplorerInfo {
  _id: string;
  name: string;
  winery?: { name?: string; region?: string };
  statistics?: Record<string, unknown>;
  vintages?: Array<{ year?: number; [key: string]: unknown }>;
  seo_name?: string;
  region?: string;
  characteristics?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EnrichRequest {
  wine_name: string;
  producer?: string;
  vintage?: number;
  min_confidence?: number;
}

interface EnrichResponse {
  enrichment_status: "matched" | "no_match" | "skipped" | "error";
  explorer?: {
    search_candidates: Array<{ _id: string; name: string }>;
    selected?: { _id: string; name: string; score: number };
    info?: WineExplorerInfo;
  };
  error_reason?: string;
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

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok || attempt === retries) return res;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === retries) throw err;
    }
  }
  throw new Error("Unreachable");
}

function rapidHeaders(apiKey: string): Record<string, string> {
  return {
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": EXPLORER_HOST,
  };
}

// ── Substring similarity (Dice coefficient on bigrams) ─────────────

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

function scoreCandidates(
  candidates: WineSearchCandidate[],
  wineName: string,
  producer?: string,
  vintage?: number,
  vintagesMap?: Map<string, number[]>,
): Array<WineSearchCandidate & { score: number }> {
  return candidates
    .map((c) => {
      let score = diceSimilarity(wineName, c.name || "");

      // Boost for producer match
      if (producer && c.winery && typeof (c as any).winery === "object") {
        const wineryName = ((c as any).winery?.name || "").toLowerCase();
        if (wineryName.includes(producer.toLowerCase())) {
          score += 0.15;
        }
      }
      // Also check top-level winery string
      if (producer) {
        const nameStr = (c.name || "").toLowerCase();
        if (nameStr.includes(producer.toLowerCase())) {
          score += 0.1;
        }
      }

      // Boost for vintage match
      if (vintage && vintagesMap?.has(c._id)) {
        const years = vintagesMap.get(c._id)!;
        if (years.includes(vintage)) score += 0.1;
      }

      return { ...c, score: Math.min(score, 1) };
    })
    .sort((a, b) => b.score - a.score);
}

// ── API calls ──────────────────────────────────────────────────────────

async function searchWines(
  apiKey: string,
  wineName: string,
): Promise<WineSearchCandidate[]> {
  const url = `${EXPLORER_BASE}/api/wines/search?query=${encodeURIComponent(wineName)}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: rapidHeaders(apiKey),
  });

  if (!res.ok) {
    throw new Error(`Wine Explorer search returned ${res.status}`);
  }

  const data = await res.json();
  // API may return array directly or { results: [...] }
  const results = Array.isArray(data) ? data : (data?.results ?? data?.wines ?? []);
  return results.slice(0, 10);
}

async function getWineInfo(
  apiKey: string,
  wineId: string,
): Promise<WineExplorerInfo> {
  const url = `${EXPLORER_BASE}/api/wines/${encodeURIComponent(wineId)}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: rapidHeaders(apiKey),
  });

  if (!res.ok) {
    throw new Error(`Wine Explorer info returned ${res.status}`);
  }

  return await res.json();
}

// ── Enrich pipeline ────────────────────────────────────────────────────

async function enrichWine(
  apiKey: string,
  req: EnrichRequest,
): Promise<EnrichResponse> {
  try {
    const candidates = await searchWines(apiKey, req.wine_name);

    if (candidates.length === 0) {
      return { enrichment_status: "no_match", explorer: { search_candidates: [] } };
    }

    const scored = scoreCandidates(
      candidates,
      req.wine_name,
      req.producer,
      req.vintage,
    );

    const MATCH_THRESHOLD = 0.3;
    const best = scored[0];

    if (!best || best.score < MATCH_THRESHOLD) {
      return {
        enrichment_status: "no_match",
        explorer: {
          search_candidates: scored.slice(0, 5).map((c) => ({
            _id: c._id,
            name: c.name,
          })),
        },
      };
    }

    // Fetch detailed info
    let info: WineExplorerInfo | undefined;
    try {
      info = await getWineInfo(apiKey, best._id);
    } catch (infoErr) {
      // Info failed but we still have search match
      return {
        enrichment_status: "matched",
        explorer: {
          search_candidates: scored.slice(0, 5).map((c) => ({
            _id: c._id,
            name: c.name,
          })),
          selected: { _id: best._id, name: best.name, score: best.score },
        },
        error_reason: "Wine info lookup failed, partial match returned",
      };
    }

    return {
      enrichment_status: "matched",
      explorer: {
        search_candidates: scored.slice(0, 5).map((c) => ({
          _id: c._id,
          name: c.name,
        })),
        selected: { _id: best._id, name: best.name, score: best.score },
        info,
      },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { enrichment_status: "error", error_reason: reason };
  }
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("RAPIDAPI_KEY");
  if (!apiKey) {
    return makeError(500, "RapidAPI key not configured");
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const action = pathParts[pathParts.length - 1];

  try {
    // GET /search?wine_name=...
    if (req.method === "GET" && action === "search") {
      const wineName = url.searchParams.get("wine_name");
      if (!wineName) return makeError(400, "wine_name query param required");

      const candidates = await searchWines(apiKey, wineName);
      return makeResponse({
        candidates: candidates.slice(0, 5).map((c) => ({ _id: c._id, name: c.name })),
      });
    }

    // GET /info?_id=...
    if (req.method === "GET" && action === "info") {
      const id = url.searchParams.get("_id");
      if (!id) return makeError(400, "_id query param required");

      const info = await getWineInfo(apiKey, id);
      return makeResponse(info);
    }

    // POST /enrich
    if (req.method === "POST" && (action === "enrich" || action === "wine-explorer")) {
      const body: EnrichRequest = await req.json();
      if (!body.wine_name) return makeError(400, "wine_name required in body");

      const result = await enrichWine(apiKey, body);
      return makeResponse(result);
    }

    return makeError(404, `Unknown action: ${action}. Use /search, /info, or /enrich`);
  } catch (err) {
    console.error("Wine Explorer error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return makeError(500, message);
  }
});
