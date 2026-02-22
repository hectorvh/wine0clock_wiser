import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RAPIDAPI_HOST = "wine-recognition2.p.rapidapi.com";
const RAPIDAPI_URL = `https://${RAPIDAPI_HOST}/v1/results`;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

interface WineCandidate {
  label: string;
  confidence: number;
}

interface RecognitionResponse {
  request_id: string;
  top_candidates: WineCandidate[];
  raw_response?: unknown;
}

function makeErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateRequestId(): string {
  return crypto.randomUUID();
}

function parseTopK(url: URL): number {
  const raw = url.searchParams.get("top_k");
  const topK = raw ? parseInt(raw, 10) : 5;
  return Math.min(Math.max(topK, 1), 10);
}

function shouldIncludeRaw(url: URL): boolean {
  return url.searchParams.get("include_raw") === "true";
}

function parseCandidates(apiResponse: any): WineCandidate[] {
  try {
    const results = apiResponse?.results ?? [];
    const candidates: WineCandidate[] = [];

    for (const result of results) {
      const entities = result?.entities ?? [];
      for (const entity of entities) {
        // The api4ai wine recognition returns objects in entity.classes or similar
        const classes = entity?.classes ?? {};
        for (const [label, confidence] of Object.entries(classes)) {
          candidates.push({ label, confidence: confidence as number });
        }
        // Also check for array-style results
        if (entity?.array) {
          for (const item of entity.array) {
            if (item?.name && item?.confidence != null) {
              candidates.push({ label: item.name, confidence: item.confidence });
            }
          }
        }
      }
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  } catch {
    return [];
  }
}

async function callRapidAPI(
  body: FormData | string,
  isUrl: boolean,
  rapidApiKey: string,
): Promise<{ apiResponse: any; status: number }> {
  const headers: Record<string, string> = {
    "X-RapidAPI-Key": rapidApiKey,
    "X-RapidAPI-Host": RAPIDAPI_HOST,
  };

  let fetchBody: FormData | string;
  if (isUrl) {
    headers["Content-Type"] = "application/json";
    fetchBody = body;
  } else {
    fetchBody = body;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(RAPIDAPI_URL, {
      method: "POST",
      headers,
      body: fetchBody,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rapidApiKey = Deno.env.get("RAPIDAPI_KEY");
  if (!rapidApiKey) {
    return makeErrorResponse(500, "RapidAPI key not configured");
  }

  const requestId = generateRequestId();
  const startTime = Date.now();
  const url = new URL(req.url);
  const topK = parseTopK(url);
  const includeRaw = shouldIncludeRaw(url);

  // Determine mode from path
  const pathParts = url.pathname.split("/");
  const mode = pathParts[pathParts.length - 1]; // "file" or "url" or just the function name

  try {
    let apiResponse: any;
    let apiStatus: number;

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data") || mode === "file") {
      // File upload mode
      const formData = await req.formData();
      const file = formData.get("file");

      if (!file || !(file instanceof File)) {
        return makeErrorResponse(400, "No file provided. Send a file in the 'file' field.");
      }

      if (file.size > MAX_FILE_SIZE) {
        return makeErrorResponse(400, `File too large. Maximum size is 10MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
      }

      if (!ALLOWED_TYPES.includes(file.type)) {
        return makeErrorResponse(400, `Invalid file type '${file.type}'. Allowed: jpg, jpeg, png, webp.`);
      }

      console.log(`[${requestId}] Processing file upload: ${file.name}, size: ${file.size}, type: ${file.type}`);

      const apiFormData = new FormData();
      apiFormData.append("image", file);

      const result = await callRapidAPI(apiFormData, false, rapidApiKey);
      apiResponse = result.apiResponse;
      apiStatus = result.status;
    } else {
      // URL mode
      const body = await req.json();
      const imageUrl = body?.url;

      if (!imageUrl || typeof imageUrl !== "string") {
        return makeErrorResponse(400, "No URL provided. Send { \"url\": \"https://...\" } in the body.");
      }

      try {
        new URL(imageUrl);
      } catch {
        return makeErrorResponse(400, "Invalid URL format.");
      }

      console.log(`[${requestId}] Processing URL: ${imageUrl}`);

      const result = await callRapidAPI(
        JSON.stringify({ url: imageUrl }),
        true,
        rapidApiKey,
      );
      apiResponse = result.apiResponse;
      apiStatus = result.status;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[${requestId}] RapidAPI responded with status ${apiStatus} in ${elapsed}ms`);

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
