/**
 * Dev-only server: receives POST request/response payloads and writes GeoJSON
 * files to backend/post-requests/. Use so logging works regardless of frontend.
 * Body: { endpoint?: string, payload?: { request?, response?, error? } }
 * response.region_geojson = WFS FeatureCollection; geometry (or null) is extracted.
 */
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LOG_POST_PORT) || 3001;
const POST_REQUESTS_DIR = path.join(__dirname, "post-requests");

// Request body sent by the frontend
interface LogPostBody {
  endpoint?: string;
  payload?: LogPayload;
}

interface LogPayload {
  request?: unknown;
  response?: {
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

function buildGeoJSON(payload: LogPayload | undefined): GeoJSONOutput {
  const regionGeo = payload?.response?.region_geojson;
  const hasFeatures =
    regionGeo != null &&
    typeof regionGeo === "object" &&
    regionGeo.type === "FeatureCollection" &&
    Array.isArray(regionGeo.features);
  const features = hasFeatures && regionGeo?.features ? regionGeo.features : [];
  const geometry =
    features.length > 0 && features[0].geometry != null ? features[0].geometry : null;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry,
        properties: {
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
  const geojson = buildGeoJSON(payload);

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
