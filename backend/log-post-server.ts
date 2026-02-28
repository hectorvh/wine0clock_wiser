/**
 * Dev-only server: receives POST request/response payloads and persists wine logs
 * to Supabase Postgres + PostGIS. Optional local GeoJSON export can be enabled
 * for debugging via LOG_POST_DEBUG_EXPORT_GEOJSON=1.
 * Body: { endpoint?: string, payload?: { request?, response?, error? } }
 */
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.LOG_POST_PORT) || 3001;
const POST_REQUESTS_DIR = path.join(__dirname, "post-requests");
const POST_IMAGES_DIR = path.join(__dirname, "post_images");
// Dev fallback until auth is implemented. Can be overridden via env.
const DEV_USER_ID = process.env.LOG_POST_DEV_USER_ID || "admin-dev";

// WFS (BKG) wine regions: layer dlm1000:objart_43001_f, veg "1040" = wine
const WFS_URL = "https://sgx.geodatenzentrum.de/wfs_dlm1000";
const WFS_LAYER = "dlm1000:objart_43001_f";
const WFS_TIMEOUT_MS = 15_000;
const DEBUG_REGION_MATCH = process.env.DEBUG_REGION_MATCH === "1" || process.env.DEBUG_REGION_MATCH === "true";

function loadEnvFromRoot(): void {
  const envPath = path.join(ROOT_DIR, ".env");
  let raw = "";
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .forEach((line) => {
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      const valueRaw = line.slice(eq + 1).trim();
      if (!key || process.env[key] != null) return;
      const unquoted =
        (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
        (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
          ? valueRaw.slice(1, -1)
          : valueRaw;
      process.env[key] = unquoted;
    });
}

loadEnvFromRoot();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

type WFSFeatureProperties = {
  veg?: string;
  nam?: string;
  region_display?: string | null;
  region_key?: string;
  wfs_nam_display?: string | null;
  wfs_nam_key?: string;
} & Record<string, unknown>;

type WFSFeature = {
  geometry?: unknown;
  properties?: WFSFeatureProperties;
};

type RegionNamePair = {
  wfs_nam_display: string;
  wfs_nam_key: string;
};

type RegionMatchResult = {
  apiRegionString: string | null;
  apiKey: string;
  candidates: RegionNamePair[];
  matchedNames: RegionNamePair[];
  features: WFSFeature[];
};

type PersistInput = {
  geojson: GeoJSONOutput;
  sourceFileName: string | null;
};

// Local GeoJSON files are no longer the source of truth.
// Optional debug file export is still supported via LOG_POST_DEBUG_EXPORT_GEOJSON.

interface BottleView {
  id: number;
  file_name: string;
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

interface DeleteBottleBody {
  file_name?: string;
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

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractVintageYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const year = Math.trunc(value);
    return year >= 1000 && year <= 9999 ? year : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  if (/^\d{4}$/.test(text)) {
    const year = Number(text);
    return Number.isFinite(year) ? year : null;
  }

  const m = text.match(/\b(1[0-9]{3}|2[0-9]{3})\b/);
  if (!m) return null;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : null;
}

/**
 * Creates a stable ASCII key for robust region-name matching.
 * Examples:
 * - "Württemberg" -> "wuerttemberg"
 * - "Hessische Bergstraße" -> "hessische-bergstrasse"
 * - "Baden, Germany" -> "baden"
 */
function normalizeRegionName(value: unknown): string {
  if (value == null) return "";
  let s = String(value).trim();
  if (!s) return "";

  // Remove common country suffixes at the tail.
  s = s.replace(/(?:,\s*(?:germany|deutschland)|\(\s*(?:germany|deutschland)\s*\))\s*$/i, "");

  // German special letters BEFORE unicode diacritic stripping.
  s = s
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "ae")
    .replace(/Ö/g, "oe")
    .replace(/Ü/g, "ue")
    .replace(/ß/g, "ss");

  s = s.toLowerCase();
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/&/g, "and");
  s = s.replace(/[.,/\\:;|_+]+/g, " ");
  s = s.replace(/[^a-z0-9 -]+/g, "");
  s = s.replace(/\s*-\s*/g, "-");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/ /g, "-");
  s = s.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

function splitRegionCountry(value: unknown): { region: string | null; country: string | null } {
  const raw = normalizeText(value);
  if (!raw) return { region: null, country: null };
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { region: parts[0] ?? null, country: parts.slice(1).join(", ") || null };
  }
  return { region: raw, country: null };
}

function normalizeWineRegionCountry(wine: Record<string, unknown>): Record<string, unknown> {
  const regionSplit = splitRegionCountry(wine.region_name);
  let region = regionSplit.region;
  let country = normalizeText(wine.country) ?? regionSplit.country;
  const vintageYear = extractVintageYear(wine.vintage);

  // Fallback: winery_description often looks like "Baden, Germany".
  if (!country) {
    const descSplit = splitRegionCountry(wine.winery_description);
    if (descSplit.country) {
      if (!region || !descSplit.region || region.toLowerCase() === descSplit.region.toLowerCase()) {
        region = region ?? descSplit.region;
        country = descSplit.country;
      }
    }
  }

  return {
    ...wine,
    region_name: region ?? null,
    country: country ?? null,
    vintage: vintageYear,
  };
}

function normalizeResponseRegionCountry(response: unknown): unknown {
  const responseObj = toObject(response);
  if (!("wine" in responseObj)) return responseObj;
  const wineObj = toObject(responseObj.wine);
  return {
    ...responseObj,
    wine: normalizeWineRegionCountry(wineObj),
  };
}

function pickApiRegionString(primary: unknown, secondary?: unknown): string | null {
  return normalizeText(primary) ?? normalizeText(secondary) ?? null;
}

function buildWFSNamePairs(features: WFSFeature[]): RegionNamePair[] {
  const seen = new Set<string>();
  const pairs: RegionNamePair[] = [];
  for (const feature of features) {
    const wfsDisplay = normalizeText(feature?.properties?.nam);
    const wfsKey = normalizeRegionName(wfsDisplay);
    if (!wfsDisplay || !wfsKey || seen.has(wfsKey)) continue;
    seen.add(wfsKey);
    pairs.push({ wfs_nam_display: wfsDisplay, wfs_nam_key: wfsKey });
  }
  return pairs;
}

function withRegionMatchMetadata(response: unknown, match: RegionMatchResult): unknown {
  const normalizedResponse = toObject(normalizeResponseRegionCountry(response));
  const wineObj = toObject(normalizedResponse.wine);
  const firstMatch = match.matchedNames[0] ?? null;
  return {
    ...normalizedResponse,
    wine: {
      ...wineObj,
      region_display: match.apiRegionString,
      region_key: match.apiKey || null,
      wfs_nam_display: firstMatch?.wfs_nam_display ?? null,
      wfs_nam_key: firstMatch?.wfs_nam_key ?? null,
    },
    region_match: {
      api_region_display: match.apiRegionString,
      api_region_key: match.apiKey || null,
      matched_feature_count: match.features.length,
      wfs_matches: match.matchedNames,
    },
  };
}

/**
 * Fetches wine region features from WFS (BKG). Filters veg === "1040" (wine).
 * If a region string is provided, filters by normalized properties.nam key.
 * Requests srsName=EPSG:4326 so geometry is in WGS84 (lon/lat), equivalent to
 * ST_AsGeoJSON(ST_Transform(geom, 4326)). Returns array of GeoJSON features, or [] on error/timeout.
 */
async function fetchWineRegionsFromWFS(regionInput?: unknown): Promise<RegionMatchResult> {
  const apiRegionString = normalizeText(regionInput);
  const apiKey = normalizeRegionName(apiRegionString);
  if (!apiKey) {
    return { apiRegionString, apiKey, candidates: [], matchedNames: [], features: [] };
  }
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
    if (!res.ok) return { apiRegionString, apiKey, candidates: [], matchedNames: [], features: [] };
    const geojson = (await res.json()) as { features?: WFSFeature[] };
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const wineFeatures = features.filter((f) => f?.properties?.veg === "1040");
    const candidates = buildWFSNamePairs(wineFeatures);
    const matched: WFSFeature[] = [];
    for (const feature of wineFeatures) {
      const wfsNamDisplay = normalizeText(feature?.properties?.nam);
      const wfsNamKey = normalizeRegionName(wfsNamDisplay);
      if (!wfsNamKey || wfsNamKey !== apiKey) continue;
      matched.push({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          region_display: apiRegionString,
          region_key: apiKey,
          wfs_nam_display: wfsNamDisplay,
          wfs_nam_key: wfsNamKey,
        },
      });
    }
    const matchedNames = buildWFSNamePairs(matched);

    if (DEBUG_REGION_MATCH) {
      console.log(
        `[region-match] apiRegionString="${apiRegionString ?? ""}" apiKey="${apiKey}" matched=${matched.length} candidates=${JSON.stringify(candidates)}`
      );
    }
    return { apiRegionString, apiKey, candidates, matchedNames, features: matched };
  } catch {
    clearTimeout(timeout);
    return { apiRegionString, apiKey, candidates: [], matchedNames: [], features: [] };
  }
}

function isPolygonGeometry(value: unknown): value is { type: "Polygon"; coordinates: unknown[] } {
  return value != null && typeof value === "object" && (value as { type?: unknown }).type === "Polygon" && Array.isArray((value as { coordinates?: unknown }).coordinates);
}

function isMultiPolygonGeometry(value: unknown): value is { type: "MultiPolygon"; coordinates: unknown[] } {
  return value != null && typeof value === "object" && (value as { type?: unknown }).type === "MultiPolygon" && Array.isArray((value as { coordinates?: unknown }).coordinates);
}

/**
 * Merges WFS-returned Polygon/MultiPolygon geometries into one MultiPolygon.
 * Returns null if no valid polygon geometry exists.
 */
function buildMultiPolygonGeometryFromWFSFeatures(features: WFSFeature[]): { type: "MultiPolygon"; coordinates: unknown[] } | null {
  const multipolygonCoordinates: unknown[] = [];
  for (const feature of features) {
    const geometry = feature?.geometry;
    if (isPolygonGeometry(geometry)) {
      multipolygonCoordinates.push(geometry.coordinates);
      continue;
    }
    if (isMultiPolygonGeometry(geometry)) {
      multipolygonCoordinates.push(...geometry.coordinates);
    }
  }
  if (multipolygonCoordinates.length === 0) return null;
  return {
    type: "MultiPolygon",
    coordinates: multipolygonCoordinates,
  };
}

function buildGeoJSON(payload: LogPayload | undefined, geometryOverride?: unknown, responseOverride?: unknown): GeoJSONOutput {
  // geometryOverride can be null or a geometry object. if undefined, fallback to payload.response.region_geojson.
  const props = {
    user_id: DEV_USER_ID,
    request: stripFileBase64FromRequest(payload?.request ?? null),
    response: stripRegionGeoJSON(responseOverride ?? normalizeResponseRegionCountry(payload?.response ?? null)),
    error: payload?.error ?? null,
  };

  const collectGeom = (): unknown | null => {
    if (geometryOverride !== undefined) return geometryOverride ?? null;
    const regionGeo = payload?.response?.region_geojson;
    if (!regionGeo || typeof regionGeo !== "object" || regionGeo.type !== "FeatureCollection" || !Array.isArray(regionGeo.features)) {
      return null;
    }
    const wfsLikeFeatures: WFSFeature[] = regionGeo.features.map((f) => ({ geometry: f?.geometry }));
    return buildMultiPolygonGeometryFromWFSFeatures(wfsLikeFeatures);
  };

  const geometry = collectGeom();
  const features: GeoJSONFeature[] = [{
    type: "Feature",
    geometry,
    properties: props,
  }];

  return {
    type: "FeatureCollection",
    features,
  };
}

function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function callSupabaseRpc<T>(fnName: string, body: Record<string, unknown>): Promise<T> {
  if (!hasSupabaseConfig()) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const url = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RPC ${fnName} failed (${res.status}): ${text}`);
  }
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

async function callSupabaseRest<T>(pathWithQuery: string, init?: RequestInit): Promise<T> {
  if (!hasSupabaseConfig()) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const url = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${pathWithQuery.replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`REST ${pathWithQuery} failed (${res.status}): ${text}`);
  }
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function normalizeErrorText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function writeGeoJSONLocal(sourceFileName: string, geojson: GeoJSONOutput): void {
  try {
    fs.mkdirSync(POST_REQUESTS_DIR, { recursive: true });
    const filepath = path.join(POST_REQUESTS_DIR, sourceFileName);
    fs.writeFileSync(filepath, JSON.stringify(geojson, null, 2), "utf8");
  } catch (e) {
    console.warn("[log-post-server] Failed local GeoJSON write", e);
  }
}

async function persistWineLogToSupabase(input: PersistInput): Promise<{ id: number }> {
  const feature = Array.isArray(input.geojson.features) && input.geojson.features.length > 0 ? input.geojson.features[0] : null;
  if (!feature || typeof feature !== "object") {
    throw new Error("persistWineLogToSupabase: missing feature");
  }
  const properties = toObject(feature.properties);
  const userId = typeof properties.user_id === "string" && properties.user_id ? properties.user_id : DEV_USER_ID;
  const manual = toObject(properties.manual);
  if (manual.timestamp != null) {
    manual.timestamp = toIsoTimestamp(manual.timestamp);
  }

  const rpcResp = await callSupabaseRpc<Array<{ id: number }>>("insert_wine_log_from_feature", {
    p_user_id: userId,
    p_request: properties.request ?? null,
    p_response: properties.response ?? null,
    p_manual: manual,
    p_error: normalizeErrorText(properties.error),
    p_geom_json: feature.geometry ?? null,
  });
  const row = Array.isArray(rpcResp) ? rpcResp[0] : null;
  return {
    id: row?.id ?? 0,
  };
}

async function readAllGeoJSONFeaturesFromDb(): Promise<{ type: "FeatureCollection"; features: GeoJSONFeature[] }> {
  if (!hasSupabaseConfig()) return { type: "FeatureCollection", features: [] };
  try {
    const resp = await callSupabaseRpc<{ type?: string; features?: GeoJSONFeature[] }>("get_wine_logs_feature_collection", {});
    if (resp && resp.type === "FeatureCollection" && Array.isArray(resp.features)) {
      return { type: "FeatureCollection", features: resp.features };
    }
  } catch (e) {
    console.warn("[log-post-server] Failed to fetch features from Supabase", e);
  }
  return { type: "FeatureCollection", features: [] };
}

async function readBottlesFromDb(): Promise<BottleView[]> {
  if (!hasSupabaseConfig()) return [];
  type DbRow = {
    id: number;
    manual_timestamp: string | null;
    created_at: string | null;
    manual_brand: string | null;
    manual_producer: string | null;
    manual_year: number | null;
    manual_region: string | null;
    manual_wine_type: string | null;
    manual_city: string | null;
    manual_score: number | null;
    manual_is_german: boolean | null;
    manual_notes: string | null;
    manual_lat: number | null;
    manual_lng: number | null;
    manual_image_path: string | null;
    response_wine_full_name: string | null;
    response_wine_producer: string | null;
    response_wine_region_name: string | null;
    response_wine_wine_type: string | null;
    response_sensory_tasting_notes: string | null;
  };

  let rows: DbRow[] = [];
  try {
    rows = await callSupabaseRest<DbRow[]>(
      "wine_logs?select=id,manual_timestamp,created_at,manual_brand,manual_producer,manual_year,manual_region,manual_wine_type,manual_city,manual_score,manual_is_german,manual_notes,manual_lat,manual_lng,manual_image_path,response_wine_full_name,response_wine_producer,response_wine_region_name,response_wine_wine_type,response_sensory_tasting_notes&order=manual_timestamp.desc.nullslast,created_at.desc"
    );
  } catch (e) {
    console.warn("[log-post-server] Failed to fetch bottles from Supabase", e);
    return [];
  }

  return rows.map((row, idx) => {
    return {
      id: idx + 1,
      file_name: `wine-log-db-${row.id}.geojson`,
      image: row.manual_image_path ?? "",
      brand: row.manual_brand || row.response_wine_full_name || "Unknown",
      producer: row.manual_producer || row.response_wine_producer || "",
      year: Number.isFinite(row.manual_year) ? row.manual_year as number : new Date().getFullYear(),
      region: row.manual_region || row.response_wine_region_name || "",
      wine_type: row.manual_wine_type || row.response_wine_wine_type || "",
      timestamp: row.manual_timestamp ?? row.created_at ?? new Date().toISOString(),
      lat: asNumber(row.manual_lat, 0),
      lng: asNumber(row.manual_lng, 0),
      city: row.manual_city ?? "",
      score: asNumber(row.manual_score, 0),
      is_german: typeof row.manual_is_german === "boolean" ? row.manual_is_german : true,
      notes: row.manual_notes || row.response_sensory_tasting_notes || "",
    };
  });
}

function parseDbIdFromFileName(sourceFileName: string): number | null {
  const m = /^wine-log-db-(\d+)\.geojson$/i.exec(sourceFileName.trim());
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

async function getImagePathBySourceFileName(sourceFileName: string): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  const id = parseDbIdFromFileName(sourceFileName);
  if (!id) return null;
  type DbRow = { manual_image_path: string | null };
  try {
    const rows = await callSupabaseRest<DbRow[]>(
      `wine_logs?select=manual_image_path&id=eq.${id}&limit=1`
    );
    const imagePath = rows?.[0]?.manual_image_path ?? "";
    if (!imagePath.startsWith("/post-images/")) return null;
    const imageName = path.basename(imagePath);
    return imageName ? path.join(POST_IMAGES_DIR, imageName) : null;
  } catch {
    return null;
  }
}

async function deleteWineLogBySourceFileName(sourceFileName: string): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const id = parseDbIdFromFileName(sourceFileName);
  if (!id) return false;
  try {
    await callSupabaseRest<unknown>(
      `wine_logs?id=eq.${id}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } }
    );
    return true;
  } catch {
    return false;
  }
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
    const bottles = await readBottlesFromDb();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(bottles));
    return;
  }

  // new endpoint returns all features (geometry + properties) collected
  // from the GeoJSON files.  useful so the frontend can render the polygons
  if (req.method === "GET" && req.url === "/features") {
    const features = await readAllGeoJSONFeaturesFromDb();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(features));
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
    const regionName = pickApiRegionString(wineObj.region_name, bottle.region);
    const wfsResult = await fetchWineRegionsFromWFS(regionName);
    const mergedGeometry = buildMultiPolygonGeometryFromWFSFeatures(wfsResult.features);
    const sanitizedAnalysis = stripRegionGeoJSON(withRegionMatchMetadata(analysis, wfsResult));
    const imagePath = saveImageDataUrl(bottle.image, data.endpoint || "wine-log");
    const bottleRegionSplit = splitRegionCountry(bottle.region);
    const analysisWine = toObject(toObject(sanitizedAnalysis).wine);
    const normalizedWineCountry = normalizeText(analysisWine.country);
    const manualRegion = bottleRegionSplit.region ?? null;
    const manualCountry = normalizeText(bottle.country) ?? bottleRegionSplit.country ?? normalizedWineCountry;

    // keep one scan = one feature; merge all matching WFS polygons into one MultiPolygon.
    const manualProps = {
      brand: bottle.brand ?? null,
      producer: bottle.producer ?? null,
      year: extractVintageYear(wineObj.vintage),
      region: manualRegion,
      country: manualCountry,
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
    };

    const baseProps = {
      user_id: DEV_USER_ID,
      request: {
        query: { mode: "analyzer", lang: "en" },
        file: data.scan_file ?? null,
        file_base64: null,
      },
      response: sanitizedAnalysis,
      error: null,
      manual: manualProps,
    };

    const features: GeoJSONFeature[] = [
      { type: "Feature", geometry: mergedGeometry, properties: baseProps },
    ];

    const geojson: GeoJSONOutput = {
      type: "FeatureCollection",
      features,
    };

    let filename = "";
    let warning: string | null = null;
    try {
      const persisted = await persistWineLogToSupabase({ geojson, sourceFileName: null });
      filename = `wine-log-db-${persisted.id}.geojson`;
    } catch (e) {
      // keep a deterministic filename even if DB write fails
      const fallbackTs = new Date().toISOString().replace(/[:.]/g, "-");
      filename = `wine-log_${fallbackTs}.geojson`;
      warning = e instanceof Error ? e.message : "Failed to persist wine log";
      console.warn("[log-post-server] save-bottle persistence warning", e);
    }
    writeGeoJSONLocal(filename, geojson);

    const bottles = await readBottlesFromDb();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, file: filename, bottle: bottles[0] ?? null, warning }));
    return;
  }

  if (req.method === "POST" && req.url === "/delete-bottle") {
    let body: string;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read body" }));
      return;
    }

    let data: DeleteBottleBody;
    try {
      data = JSON.parse(body) as DeleteBottleBody;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const requestedName = typeof data.file_name === "string" ? data.file_name.trim() : "";
    const fileName = path.basename(requestedName);
    if (!fileName || !fileName.toLowerCase().endsWith(".geojson")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid file_name" }));
      return;
    }

    const imagePath = await getImagePathBySourceFileName(fileName);
    let imageDeleted = false;
    if (imagePath && imagePath.startsWith(POST_IMAGES_DIR)) {
      try {
        fs.unlinkSync(imagePath);
        imageDeleted = true;
      } catch {
        imageDeleted = false;
      }
    }

    const deleted = await deleteWineLogBySourceFileName(fileName);
    if (!deleted) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Wine log not found" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted: { geojson: true, image: imageDeleted } }));
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
  const payloadObj = toObject(payload);
  const payloadManual = toObject(payloadObj.manual);
  const regionName = pickApiRegionString(payload?.response?.wine?.region_name, payloadManual.region);
  const wfsResult = await fetchWineRegionsFromWFS(regionName);
  const mergedGeometry = buildMultiPolygonGeometryFromWFSFeatures(wfsResult.features);
  const responseOverride = withRegionMatchMetadata(payload?.response ?? null, wfsResult);
  const geojson = buildGeoJSON(payload, mergedGeometry ?? undefined, responseOverride);

  let filename = "";
  let warning: string | null = null;
  try {
    const persisted = await persistWineLogToSupabase({ geojson, sourceFileName: null });
    filename = `wine-log-db-${persisted.id}.geojson`;
  } catch (e) {
    const fallbackTs = new Date().toISOString().replace(/[:.]/g, "-");
    filename = `wine-log_${fallbackTs}.geojson`;
    warning = e instanceof Error ? e.message : "Failed to persist wine log";
    console.warn("[log-post-server] log-post persistence warning", e);
  }
  writeGeoJSONLocal(filename, geojson);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, file: filename, warning }));
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err?.code === "EADDRINUSE") {
    console.warn(`[log-post-server] Port ${PORT} already in use. Reusing existing server instance.`);
    // Exit successfully so concurrent dev scripts keep running frontend.
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`[log-post-server] POST http://localhost:${PORT}/log-post → Supabase/PostGIS`);
});
