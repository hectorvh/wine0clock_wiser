/**
 * Dev-only server: receives POST request/response payloads and writes GeoJSON
 * files to backend/post-requests/. When the wine analyzer response includes
 * region_name, fetches wine region geometry from WFS (BKG) and adds it to the file.
 * Body: { endpoint?: string, payload?: { request?, response?, error? } }
 */
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LOG_POST_PORT) || 3001;
const POST_REQUESTS_DIR = path.join(__dirname, "post-requests");
// Dev fallback until auth is implemented. Can be overridden via env.
const DEV_USER_ID = process.env.LOG_POST_DEV_USER_ID || "admin-dev";

// WFS (BKG) wine regions: layer dlm1000:objart_43001_f, veg "1040" = wine
const WFS_URL = "https://sgx.geodatenzentrum.de/wfs_dlm1000";
const WFS_LAYER = "dlm1000:objart_43001_f";
const WFS_TIMEOUT_MS = 15_000;

// Request body sent by the frontend
interface LogPostBody {
  endpoint?: string;
  payload?: LogPayload;
}

interface LogPayload {
  request?: unknown;
  response?: {
    wine?: { region_name?: string | null };
    region_geojson?: {
      type?: string;
      features?: Array<{ geometry?: unknown }>;
    };
  };
  error?: unknown;
}

// GeoJSON we write to disk
interface GeoJSONFeature {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, unknown>;
}

interface GeoJSONOutput {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Fetches wine region features from WFS (BKG). Filters veg === "1040" (wine).
 * If regionName is provided, filters by properties.nam (exact match).
 * Requests srsName=EPSG:4326 so geometry is in WGS84 (lon/lat), equivalent to
 * ST_AsGeoJSON(ST_Transform(geom, 4326)). Returns array of GeoJSON features, or [] on error/timeout.
 */
async function fetchWineRegionsFromWFS(regionName?: string | null): Promise<Array<{ geometry?: unknown; properties?: Record<string, unknown> }>> {
  if (regionName == null || String(regionName).trim() === "") return [];
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typename: WFS_LAYER,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  const url = `${WFS_URL}?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WFS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const geojson = (await res.json()) as { features?: Array<{ properties?: { veg?: string; nam?: string }; geometry?: unknown }> };
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    let filtered = features.filter((f) => f?.properties?.veg === "1040");
    const name = String(regionName).trim();
    if (name) filtered = filtered.filter((f) => f?.properties?.nam === name);
    return filtered;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

function buildGeoJSON(payload: LogPayload | undefined, geometryOverride: unknown | null = null): GeoJSONOutput {
  let geometry: unknown = geometryOverride;
  if (geometry === undefined || geometry === null) {
    const regionGeo = payload?.response?.region_geojson;
    const hasFeatures =
      regionGeo != null &&
      typeof regionGeo === "object" &&
      regionGeo.type === "FeatureCollection" &&
      Array.isArray(regionGeo.features);
    const features = hasFeatures && regionGeo?.features ? regionGeo.features : [];
    geometry = features.length > 0 && features[0].geometry != null ? features[0].geometry : null;
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry,
        properties: {
          user_id: DEV_USER_ID,
          request: payload?.request ?? null,
          response: payload?.response ?? null,
          error: payload?.error ?? null,
        },
      },
    ],
  };
}

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/log-post") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. POST /log-post with { endpoint, payload }." }));
    return;
  }

  let body: string;
  try {
    body = await parseBody(req);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to read body" }));
    return;
  }

  let data: LogPostBody;
  try {
    data = JSON.parse(body) as LogPostBody;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const payload = data.payload;
  const regionName = payload?.response?.wine?.region_name ?? null;
  const wfsFeatures = await fetchWineRegionsFromWFS(regionName);
  const wfsGeometry =
    wfsFeatures.length > 0 && wfsFeatures[0].geometry != null ? wfsFeatures[0].geometry : null;
  const geojson = buildGeoJSON(payload, wfsGeometry);

  try {
    fs.mkdirSync(POST_REQUESTS_DIR, { recursive: true });
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to create post-requests dir" }));
    return;
  }

  const safeName = (data.endpoint || "post").replace(/[^a-z0-9-_]/gi, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safeName}_${timestamp}.geojson`;
  const filepath = path.join(POST_REQUESTS_DIR, filename);

  try {
    fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to write file" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, file: filename }));
});

server.listen(PORT, () => {
  console.log(`[log-post-server] POST http://localhost:${PORT}/log-post → ${POST_REQUESTS_DIR}`);
});
