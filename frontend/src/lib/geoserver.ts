// Use relative /geoserver in dev so Vite proxy can forward to GeoServer (avoids CORS).
// Set VITE_GEOSERVER_BASE_URL to full URL (e.g. https://geo.example.com/geoserver) when not using proxy.
export const GEOSERVER_BASE =
  (import.meta.env.VITE_GEOSERVER_BASE_URL as string) ||
  (typeof window !== "undefined" ? `${window.location.origin}/geoserver` : "http://localhost:8080/geoserver");

export const GEOSERVER_WORKSPACE =
  (import.meta.env.VITE_GEOSERVER_WORKSPACE as string) ?? "wine0clock";

export function buildWfsGetFeatureUrl(params: {
  typeName: string;
  bbox?: [number, number, number, number];
  limit?: number;
}): string {
  const url = new URL(`${GEOSERVER_BASE}/${GEOSERVER_WORKSPACE}/wfs`);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", params.typeName);
  url.searchParams.set("outputFormat", "application/json");

  if (params.limit) url.searchParams.set("count", String(params.limit));

  if (params.bbox) {
    const [minX, minY, maxX, maxY] = params.bbox;
    url.searchParams.set("bbox", `${minX},${minY},${maxX},${maxY},EPSG:4326`);
  }

  return url.toString();
}

export async function fetchWineLogsWfs(opts?: {
  bbox?: [number, number, number, number];
  limit?: number;
}): Promise<GeoJSON.FeatureCollection> {
  const url = buildWfsGetFeatureUrl({
    typeName: `${GEOSERVER_WORKSPACE}:wine_logs`,
    bbox: opts?.bbox,
    limit: opts?.limit ?? 5000,
  });

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GeoServer WFS error ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as GeoJSON.FeatureCollection;
}
