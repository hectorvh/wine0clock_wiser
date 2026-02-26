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
const POST_IMAGES_DIR = path.join(__dirname, "post_images");
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

interface BottleView {
  id: number;
  image: string;
  brand: string;
  producer: string;
  year: number;
  region: string;
  wine_type: string;
  timestamp: string;
  lat: number;
  lng: number;
  city: string;
  score: number;
  is_german: boolean;
  notes: string;
}

interface SaveBottleBody {
  endpoint?: string;
  bottle?: Record<string, unknown>;
  analysis_result?: unknown;
  scan_file?: { name?: string; size?: number; type?: string } | null;
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toObject(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function imageMimeToExtension(mime: string): string {
  const clean = mime.trim().toLowerCase();
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/jpg" || clean === "image/jpeg") return "jpg";
  return "jpg";
}

function parseDataUrlImage(dataUrl: string): { mime: string; buffer: Buffer; extension: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const extension = imageMimeToExtension(mime);
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0) return null;
    return { mime, buffer, extension };
  } catch {
    return null;
  }
}

function saveImageDataUrl(imageValue: unknown, prefix = "wine-log"): string | null {
  if (typeof imageValue !== "string" || imageValue.trim() === "") return null;
  const parsed = parseDataUrlImage(imageValue.trim());
  if (!parsed) return null;
  try {
    fs.mkdirSync(POST_IMAGES_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safePrefix = prefix.replace(/[^a-z0-9-_]/gi, "_");
    const filename = `${safePrefix}_${timestamp}.${parsed.extension}`;
    const filePath = path.join(POST_IMAGES_DIR, filename);
    fs.writeFileSync(filePath, parsed.buffer);
    return `/post-images/${filename}`;
  } catch {
    return null;
  }
}

function stripFileBase64FromRequest(request: unknown): unknown {
  const requestObj = toObject(request);
  if (!("file_base64" in requestObj)) return request;
  const { file_base64: _ignored, ...rest } = requestObj;
  return { ...rest, file_base64: null };
}

function stripRegionGeoJSON(response: unknown): unknown {
  const responseObj = toObject(response);
  if (!("region_geojson" in responseObj)) return response;
  const { region_geojson: _ignored, ...rest } = responseObj;
  return rest;
}

function readBottlesFromGeoJSONFiles(): BottleView[] {
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(POST_REQUESTS_DIR)
      .filter((f) => f.toLowerCase().endsWith(".geojson"));
  } catch {
    return [];
  }

  const rows: Array<Omit<BottleView, "id">> = [];
  for (const file of files) {
    const filepath = path.join(POST_REQUESTS_DIR, file);
    try {
      const raw = fs.readFileSync(filepath, "utf8");
      const parsed = JSON.parse(raw) as { features?: Array<{ properties?: Record<string, unknown> }> };
      const feature = Array.isArray(parsed?.features) && parsed.features.length > 0 ? parsed.features[0] : null;
      const properties = toObject(feature?.properties);
      const manual = toObject(properties.manual);
      const response = toObject(properties.response);
      const wine = toObject(response.wine);
      const sensory = toObject(response.sensory);
      const request = toObject(properties.request);
      const fileMeta = toObject(request.file);

      const timestamp =
        typeof manual.timestamp === "string"
          ? manual.timestamp
          : fs.statSync(filepath).mtime.toISOString();

      let image = "";
      if (typeof manual.image_path === "string" && manual.image_path.trim() !== "") {
        image = manual.image_path;
      } else if (typeof manual.image_data_url === "string") {
        image = manual.image_data_url;
      } else if (typeof properties.image_data_url === "string") {
        image = properties.image_data_url;
      } else if (typeof request.file_base64 === "string" && request.file_base64.length > 0) {
        const mime = typeof fileMeta.type === "string" ? fileMeta.type : "image/jpeg";
        image = `data:${mime};base64,${request.file_base64}`;
      }

      const country = typeof wine.country === "string" ? wine.country.toLowerCase() : "";
      const vintage =
        typeof wine.vintage === "string"
          ? Number.parseInt(wine.vintage, 10)
          : asNumber(manual.year, new Date().getFullYear());

      rows.push({
        image,
        brand:
          (typeof manual.brand === "string" && manual.brand) ||
          (typeof wine.full_name === "string" && wine.full_name) ||
          (typeof fileMeta.name === "string" && fileMeta.name) ||
          "Unknown",
        producer:
          (typeof manual.producer === "string" && manual.producer) ||
          (typeof wine.producer === "string" && wine.producer) ||
          (typeof wine.winery === "string" ? wine.winery : ""),
        year: Number.isFinite(vintage) ? vintage : new Date().getFullYear(),
        region:
          (typeof manual.region === "string" && manual.region) ||
          (typeof wine.region_name === "string" ? wine.region_name : ""),
        wine_type:
          (typeof manual.wine_type === "string" && manual.wine_type) ||
          (typeof wine.wine_type === "string" ? wine.wine_type : ""),
        timestamp,
        lat: asNumber(manual.lat, 0),
        lng: asNumber(manual.lng, 0),
        city: typeof manual.city === "string" ? manual.city : "",
        score: asNumber(manual.score, 0),
        is_german:
          typeof manual.is_german === "boolean"
            ? manual.is_german
            : country
              ? country.includes("germany") || country.includes("deutsch")
              : true,
        notes:
          (typeof manual.notes === "string" && manual.notes) ||
          (typeof sensory.tasting_notes === "string" ? sensory.tasting_notes : ""),
      });
    } catch {
      // ignore invalid/unexpected files
    }
  }

  rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return rows.map((row, idx) => ({ id: idx + 1, ...row }));
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
          request: stripFileBase64FromRequest(payload?.request ?? null),
          response: stripRegionGeoJSON(payload?.response ?? null),
          error: payload?.error ?? null,
        },
      },
    ],
  };
}

const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/bottles") {
    const bottles = readBottlesFromGeoJSONFiles();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(bottles));
    return;
  }

  if (req.method === "GET" && req.url && req.url.startsWith("/post-images/")) {
    const rawName = req.url.slice("/post-images/".length);
    const imageName = path.basename(decodeURIComponent(rawName));
    if (!imageName) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid image path" }));
      return;
    }

    const filePath = path.join(POST_IMAGES_DIR, imageName);
    if (!filePath.startsWith(POST_IMAGES_DIR)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid image path" }));
      return;
    }

    try {
      const ext = path.extname(imageName).toLowerCase();
      const contentType =
        ext === ".png"
          ? "image/png"
          : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
      return;
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Image not found" }));
      return;
    }
  }

  if (req.method === "POST" && req.url === "/save-bottle") {
    let body: string;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read body" }));
      return;
    }

    let data: SaveBottleBody;
    try {
      data = JSON.parse(body) as SaveBottleBody;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const bottle = toObject(data.bottle);
    const analysis = data.analysis_result ?? null;
    const analysisObj = toObject(analysis);
    const wineObj = toObject(analysisObj.wine);
    const regionName = typeof wineObj.region_name === "string" ? wineObj.region_name : null;
    const wfsFeatures = await fetchWineRegionsFromWFS(regionName);
    const geometry = wfsFeatures.length > 0 && wfsFeatures[0].geometry != null ? wfsFeatures[0].geometry : null;
    const sanitizedAnalysis = stripRegionGeoJSON(analysis);
    const imagePath = saveImageDataUrl(bottle.image, data.endpoint || "wine-log");

    const geojson: GeoJSONOutput = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry,
          properties: {
            user_id: DEV_USER_ID,
            request: {
              query: { mode: "analyzer", lang: "en" },
              file: data.scan_file ?? null,
              file_base64: null,
            },
            response: sanitizedAnalysis,
            error: null,
            manual: {
              brand: bottle.brand ?? null,
              producer: bottle.producer ?? null,
              year: bottle.year ?? null,
              region: bottle.region ?? null,
              wine_type: bottle.wine_type ?? null,
              is_german: bottle.is_german ?? true,
              city: bottle.city ?? null,
              score: bottle.score ?? null,
              notes: bottle.notes ?? null,
              lat: bottle.lat ?? null,
              lng: bottle.lng ?? null,
              image_path: imagePath,
              image_data_url: null,
              timestamp: new Date().toISOString(),
            },
          },
        },
      ],
    };

    try {
      fs.mkdirSync(POST_REQUESTS_DIR, { recursive: true });
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to create post-requests dir" }));
      return;
    }

    const safeName = (data.endpoint || "bottle-log").replace(/[^a-z0-9-_]/gi, "_");
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

    const bottles = readBottlesFromGeoJSONFiles();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, file: filename, bottle: bottles[0] ?? null }));
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
