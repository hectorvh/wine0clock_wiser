import { Bottle, Stats } from "../types";

const STORAGE_KEY = "winetrack_bottles_v1";
const ID_KEY = "winetrack_next_id_v1";
const LOG_POST_URL = (import.meta.env.VITE_LOG_POST_URL as string) || "http://localhost:3001/log-post";
const LOG_SERVER_BASE = LOG_POST_URL.replace(/\/log-post\/?$/, "").replace(/\/$/, "");
type ScanFileMeta = { name?: string; size?: number; type?: string } | null;

function getLogServerCandidates(): string[] {
  const candidates = new Set<string>();
  if (LOG_SERVER_BASE) candidates.add(LOG_SERVER_BASE);
  if (typeof window !== "undefined" && window.location?.hostname) {
    candidates.add(`${window.location.protocol}//${window.location.hostname}:3001`);
  }
  candidates.add("http://localhost:3001");
  return Array.from(candidates);
}

export function getLogServerBase(): string {
  return getLogServerCandidates()[0];
}

async function fetchWithServerFallback(path: string, init?: RequestInit): Promise<Response> {
  const candidates = getLogServerCandidates();
  let lastError: unknown = null;
  for (const base of candidates) {
    const url = `${base}${path}`;
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status >= 500) {
        lastError = new Error(`Server error at ${url}: ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to connect to log server");
}

function loadBottles(): Bottle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Bottle[];
  } catch (e) {
    console.error("Failed to parse bottles from localStorage", e);
    return [];
  }
}

function saveBottles(bottles: Bottle[], notify = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bottles));
  const nextId = bottles.length > 0 ? Math.max(...bottles.map((b) => b.id)) + 1 : 1;
  localStorage.setItem(ID_KEY, String(nextId));
  if (notify) {
    window.dispatchEvent(new CustomEvent("winetrack:data-changed"));
  }
}

export function getAllBottles(): Bottle[] {
  return loadBottles().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export async function syncBottlesFromFiles(): Promise<Bottle[]> {
  try {
    const res = await fetchWithServerFallback("/bottles");
    if (!res.ok) throw new Error(`Failed to load bottles: ${res.status}`);
    const bottles = (await res.json()) as Bottle[];
    saveBottles(Array.isArray(bottles) ? bottles : [], false);
    return getAllBottles();
  } catch (e) {
    console.warn("Using local cached bottles. Could not sync from GeoJSON files.", e);
    return getAllBottles();
  }
}

function saveBottleLocal(data: Partial<Bottle>): Bottle {
  const bottles = loadBottles();
  const nextId = parseInt(localStorage.getItem(ID_KEY) || "1", 10);
  const id = nextId;
  localStorage.setItem(ID_KEY, String(nextId + 1));

  const bottle: Bottle = {
    id,
    image: data.image || "",
    brand: data.brand || "Unknown",
    producer: data.producer || "",
    year: data.year || new Date().getFullYear(),
    region: data.region || "",
    wine_type: data.wine_type || "",
    timestamp: data.timestamp || new Date().toISOString(),
    lat: typeof data.lat === "number" ? data.lat : 0,
    lng: typeof data.lng === "number" ? data.lng : 0,
    city: data.city || "",
    score: typeof data.score === "number" ? data.score : 0,
    is_german: typeof data.is_german === "boolean" ? data.is_german : true,
    notes: data.notes || "",
  };

  bottles.push(bottle);
  saveBottles(bottles);
  return bottle;
}

export async function saveBottle(
  data: Partial<Bottle> & { analysis_result?: unknown; scan_file?: ScanFileMeta },
): Promise<Bottle> {
  try {
    const res = await fetchWithServerFallback("/save-bottle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "wine-log",
        bottle: {
          brand: data.brand ?? null,
          producer: data.producer ?? null,
          year: data.year ?? null,
          region: data.region ?? null,
          wine_type: data.wine_type ?? null,
          is_german: data.is_german ?? true,
          city: data.city ?? null,
          score: data.score ?? null,
          notes: data.notes ?? null,
          lat: data.lat ?? null,
          lng: data.lng ?? null,
          image: data.image ?? null,
          timestamp: data.timestamp ?? new Date().toISOString(),
        },
        analysis_result: data.analysis_result ?? null,
        scan_file: data.scan_file ?? null,
      }),
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("GeoJSON DB endpoint not found. Restart backend log server to load latest /save-bottle route.");
      }
      throw new Error(`Failed to save to GeoJSON DB: ${res.status}`);
    }
    const body = (await res.json()) as { bottle?: Bottle };
    await syncBottlesFromFiles();
    if (body?.bottle) return body.bottle;
    const latest = getAllBottles()[0];
    if (latest) return latest;
    throw new Error("Bottle saved but no response bottle");
  } catch (e) {
    console.warn("Falling back to localStorage save. GeoJSON DB unavailable.", e);
    return saveBottleLocal(data);
  }
}

export function updateBottle(id: number, patch: Partial<Bottle>): Bottle | null {
  const bottles = loadBottles();
  const idx = bottles.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const updated = { ...bottles[idx], ...patch };
  bottles[idx] = updated;
  saveBottles(bottles);
  return updated;
}

export async function deleteBottle(id: number): Promise<boolean> {
  try {
    const bottles = loadBottles();
    const target = bottles.find((b) => b.id === id);
    if (!target) return false;

    if (target.file_name) {
      const res = await fetchWithServerFallback("/delete-bottle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_name: target.file_name }),
      });
      if (!res.ok) return false;
      await syncBottlesFromFiles();
      return true;
    }

    const filtered = bottles.filter((b) => b.id !== id);
    if (filtered.length === bottles.length) return false;
    saveBottles(filtered);
    return true;
  } catch (e) {
    console.error("Failed to delete bottle", e);
    return false;
  }
}

export function getStats(): Stats {
  const bottles = loadBottles();
  const totalBottles = bottles.length;
  const activeRegions = new Set(bottles.map((b) => b.region).filter(Boolean)).size;
  const scores = bottles.map((b) => b.score).filter((s) => typeof s === "number" && !isNaN(s));
  const avgScore = scores.length ? Math.round((scores.reduce((a, c) => a + c, 0) / scores.length) * 10) / 10 : 0;
  return { totalBottles, activeRegions, avgScore };
}

export function getAggregatedMap() {
  const bottles = loadBottles();
  const productionMap: Record<string, { region: string; count: number; brands: string[] }> = {};
  const consumptionMap: Record<string, { city: string; lat: number; lng: number; count: number; brands: Set<string>; origins: Set<string> }> = {};

  bottles.forEach((b) => {
    if (b.region && b.is_german) {
      const key = b.region;
      if (!productionMap[key]) productionMap[key] = { region: key, count: 0, brands: [] };
      productionMap[key].count += 1;
      if (b.brand && !productionMap[key].brands.includes(b.brand)) productionMap[key].brands.push(b.brand);
    }

    const cityKey = b.city || `lat:${b.lat}_lng:${b.lng}`;
    if (!consumptionMap[cityKey]) {
      consumptionMap[cityKey] = { city: b.city || "Unknown", lat: b.lat || 0, lng: b.lng || 0, count: 0, brands: new Set(), origins: new Set() };
    }
    consumptionMap[cityKey].count += 1;
    if (b.brand) consumptionMap[cityKey].brands.add(b.brand);
    if (b.region) consumptionMap[cityKey].origins.add(b.region);
  });

  const production = Object.values(productionMap).map((p) => ({ region: p.region, count: p.count, brands: p.brands.join(", ") }));
  const consumption = Object.values(consumptionMap).map((c) => ({ city: c.city, lat: c.lat, lng: c.lng, count: c.count, brands: Array.from(c.brands).join(", "), origins: Array.from(c.origins).join(", ") }));

  return { production, consumption };
}

export async function fetchRegionsGeoJSON(): Promise<unknown> {
  try {
    const resp = await fetch("https://raw.githubusercontent.com/johan/world.geo.json/master/countries/DEU.geo.json");
    if (!resp.ok) throw new Error("Fetch failed");
    return await resp.json();
  } catch (e) {
    console.warn("Failed to fetch geojson, returning fallback", e);
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { name: "Germany (Fallback)" },
        geometry: {
          type: "Polygon",
          coordinates: [[[5.8, 47.2], [15.0, 47.2], [15.0, 55.0], [5.8, 55.0], [5.8, 47.2]]],
        },
      }],
    };
  }
}

export default {
  getLogServerBase,
  syncBottlesFromFiles,
  getAllBottles,
  saveBottle,
  updateBottle,
  deleteBottle,
  getStats,
  getAggregatedMap,
  fetchRegionsGeoJSON,
};
