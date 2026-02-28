import { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, Circle, CircleMarker, Tooltip, LayerGroup, Pane, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import storage from "../lib/storage";
import L from "leaflet";
import pointOnFeature from "@turf/point-on-feature";
import type { Bottle } from "../types";

const markerIcon = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png";
const markerShadow = "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

interface AggregatedPoint {
  city: string;
  lat: number;
  lng: number;
  count: number;
  brands: string;
  origins: string;
}

interface AggregatedProd {
  region: string;
  count: number;
  brands: string;
}

interface RegionStats {
  frequency: number;
  wineTypeCounts: Record<string, { label: string; count: number }>;
}

interface ProductionRegionSymbol {
  regionId: string;
  regionName: string;
  representative: [number, number];
  feature: GeoJSON.Feature;
  frequency: number;
  top3WineTypes: Array<{ wine_type: string; count: number }>;
}

function normalizeRegionKey(value: unknown): string {
  if (value == null) return "";
  let s = String(value).trim();
  if (!s) return "";
  s = s
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "ae")
    .replace(/Ö/g, "oe")
    .replace(/Ü/g, "ue")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[.,/\\:;|_+]+/g, " ")
    .replace(/[^a-z0-9 -]+/g, "")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return s;
}

function getRepresentativePoint(feature: GeoJSON.Feature): [number, number] | null {
  try {
    const pt = pointOnFeature(feature as any) as GeoJSON.Feature<GeoJSON.Point>;
    const [lng, lat] = pt.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  } catch {
    return null;
  }
}

function normalizeWineType(value: unknown): { key: string; label: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  const label = key
    .split(/\s+/)
    .map((w) => (w ? `${w[0].toUpperCase()}${w.slice(1)}` : w))
    .join(" ");
  return { key, label };
}

function ProductionZoomHandler({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  useMapEvents({
    zoomend: (ev) => onZoomChange(ev.target.getZoom()),
  });
  return null;
}

export default function WineMap() {
  const [aggregatedData, setAggregatedData] = useState<{ production: AggregatedProd[]; consumption: AggregatedPoint[] } | null>(null);
  const [bottles, setBottles] = useState<Bottle[]>([]);
  const [geoData, setGeoData] = useState<GeoJSON.GeoJsonObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"production" | "consumption">("consumption");
  const [productionZoom, setProductionZoom] = useState(6);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const handler = () => { setLoading(true); fetchData(); };
    window.addEventListener("winetrack:data-changed", handler);
    return () => window.removeEventListener("winetrack:data-changed", handler);
  }, []);

  const fetchData = async () => {
    let aggData = storage.getAggregatedMap() as { production: AggregatedProd[]; consumption: AggregatedPoint[] };
    try {
      await storage.syncBottlesFromFiles();
      aggData = storage.getAggregatedMap() as { production: AggregatedProd[]; consumption: AggregatedPoint[] };
    } catch (err) {
      console.error("Failed to fetch map data", err);
    } finally {
      // try to read any polygons the dev server has written; fall back to the
      // static country boundary if none are available.
      let nextGeoData = await storage.fetchLoggedFeatures() as GeoJSON.GeoJsonObject;
      if (!nextGeoData ||
          nextGeoData.type !== "FeatureCollection" ||
          (Array.isArray(nextGeoData.features) && nextGeoData.features.length === 0)) {
        nextGeoData = await storage.fetchRegionsGeoJSON() as GeoJSON.GeoJsonObject;
      }
      setAggregatedData(aggData);
      setBottles(storage.getAllBottles());
      setGeoData(nextGeoData);
      setLoading(false);
    }
  };

  const productionSymbols = useMemo<ProductionRegionSymbol[]>(() => {
    if (!geoData || geoData.type !== "FeatureCollection" || !Array.isArray(geoData.features)) return [];

    const regionById = new Map<string, { regionName: string; feature: GeoJSON.Feature; representative: [number, number] }>();
    for (const rawFeature of geoData.features) {
      if (!rawFeature || rawFeature.type !== "Feature" || !rawFeature.geometry) continue;
      const geomType = rawFeature.geometry.type;
      if (geomType !== "Polygon" && geomType !== "MultiPolygon") continue;

      const props = (rawFeature.properties ?? {}) as Record<string, any>;
      const wine = (props.response?.wine ?? {}) as Record<string, any>;
      const manual = (props.manual ?? {}) as Record<string, any>;
      const regionId = normalizeRegionKey(
        wine.region_key ?? props.region_id ?? props.region_name ?? wine.region_name ?? manual.region ?? props.name
      );
      if (!regionId) continue;
      if (regionById.has(regionId)) continue;

      const representative = getRepresentativePoint(rawFeature as GeoJSON.Feature);
      if (!representative) continue;
      const regionName = String(
        wine.region_display ?? wine.region_name ?? props.region_name ?? manual.region ?? props.name ?? regionId
      ).trim();
      regionById.set(regionId, {
        regionName: regionName || regionId,
        feature: rawFeature as GeoJSON.Feature,
        representative,
      });
    }

    const statsByRegion: Record<string, RegionStats> = {};
    for (const bottle of bottles) {
      const regionId = normalizeRegionKey(bottle.region);
      if (!regionId) continue;
      if (!regionById.has(regionId)) continue;
      if (!statsByRegion[regionId]) {
        statsByRegion[regionId] = {
          frequency: 0,
          wineTypeCounts: {},
        };
      }
      const bucket = statsByRegion[regionId];
      bucket.frequency += 1;
      const wineType = normalizeWineType(bottle.wine_type);
      if (wineType) {
        if (!bucket.wineTypeCounts[wineType.key]) {
          bucket.wineTypeCounts[wineType.key] = { label: wineType.label, count: 0 };
        }
        bucket.wineTypeCounts[wineType.key].count += 1;
      }
    }

    return Object.entries(statsByRegion)
      .filter(([, stats]) => stats.frequency > 0)
      .map(([regionId, stats]) => {
        const region = regionById.get(regionId);
        if (!region) return null;
        const top3WineTypes = Object.values(stats.wineTypeCounts)
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map((v) => ({ wine_type: v.label, count: v.count }));
        return {
          regionId,
          regionName: region.regionName,
          representative: region.representative,
          feature: region.feature,
          frequency: stats.frequency,
          top3WineTypes,
        } satisfies ProductionRegionSymbol;
      })
      .filter((v): v is ProductionRegionSymbol => v != null);
  }, [geoData, bottles]);

  const regionFeatureCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    return {
      type: "FeatureCollection",
      features: productionSymbols.map((s) => s.feature),
    };
  }, [productionSymbols]);

  const symbolByRegionId = useMemo(() => {
    const map = new Map<string, ProductionRegionSymbol>();
    for (const symbol of productionSymbols) map.set(symbol.regionId, symbol);
    return map;
  }, [productionSymbols]);

  const activeHighlightRegionId = hoveredRegionId ?? selectedRegionId;
  const highlightFeatureCollection = useMemo<GeoJSON.FeatureCollection>(() => {
    const selected = activeHighlightRegionId ? symbolByRegionId.get(activeHighlightRegionId) : null;
    return {
      type: "FeatureCollection",
      features: selected ? [selected.feature] : [],
    };
  }, [activeHighlightRegionId, symbolByRegionId]);

  const maxFrequency = useMemo(
    () => productionSymbols.reduce((max, s) => Math.max(max, s.frequency), 0),
    [productionSymbols]
  );
  if (loading) return <div className="h-screen flex items-center justify-center text-[#A1A19A] italic">Loading Map...</div>;

  return (
    <div className="h-[calc(100vh-80px)] w-full relative">
      <MapContainer
        center={[51.1657, 10.4515]}
        zoom={6}
        className="h-full w-full"
        zoomControl={false}
      >
        <ProductionZoomHandler onZoomChange={setProductionZoom} />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
        />

        {viewMode === "production" && (
          <>
            <Pane name="production-polygons-pane" style={{ zIndex: 410 }} />
            <Pane name="production-circles-pane" style={{ zIndex: 420 }} />
            <Pane name="production-highlight-pane" style={{ zIndex: 430 }} />

            {/* productionPolygonLayer: always mounted; style changes by zoom only */}
            <LayerGroup>
              <GeoJSON
                key={`prod-polygons-${regionFeatureCollection.features.length}`}
                data={regionFeatureCollection}
                pane="production-polygons-pane"
                style={() => {
                  if (productionZoom < 7) {
                    return { color: "#5A5A40", weight: 0, opacity: 0, fillOpacity: 0 };
                  }
                  if (productionZoom < 10) {
                    return { color: "#5A5A40", weight: 0.8, opacity: 0.2, fillOpacity: 0 };
                  }
                  return { color: "#5A5A40", weight: 1.2, opacity: 0.45, fillOpacity: 0 };
                }}
                onEachFeature={(feature, layer) => {
                  if (productionZoom < 10) return;
                  const props = (feature?.properties ?? {}) as Record<string, any>;
                  const wine = (props.response?.wine ?? {}) as Record<string, any>;
                  const manual = (props.manual ?? {}) as Record<string, any>;
                  const regionId = normalizeRegionKey(
                    wine.region_key ?? props.region_id ?? props.region_name ?? wine.region_name ?? manual.region ?? props.name
                  );
                  if (!regionId) return;
                  layer.on("click", () => {
                    setSelectedRegionId(regionId);
                    setHoveredRegionId(null);
                  });
                }}
              />
            </LayerGroup>

            {/* productionCircleLayer: proportional symbols at representative points */}
            <LayerGroup>
              {productionSymbols.map((symbol) => {
                const minRadius = 7;
                const maxRadius = 24;
                const scaleFactor = maxFrequency > 0 ? (maxRadius - minRadius) / Math.sqrt(maxFrequency) : 0;
                const radiusRaw = minRadius + Math.sqrt(Math.max(0, symbol.frequency)) * scaleFactor;
                const radius = Math.max(minRadius, Math.min(maxRadius, radiusRaw));

                return (
                  <CircleMarker
                    key={`prod-circle-${symbol.regionId}`}
                    center={symbol.representative}
                    pane="production-circles-pane"
                    radius={radius}
                    pathOptions={{
                      fillColor: "#8B4513",
                      fillOpacity: 0.65,
                      color: "#5A2F0D",
                      weight: 1,
                      opacity: 0.9,
                    }}
                    eventHandlers={{
                      mouseover: () => setHoveredRegionId(symbol.regionId),
                      mouseout: () => setHoveredRegionId((curr) => (curr === symbol.regionId ? null : curr)),
                      click: () => {
                        setSelectedRegionId(symbol.regionId);
                        setHoveredRegionId(null);
                      },
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
                      <div className="text-[11px]">
                        <div className="font-bold">{symbol.regionName}</div>
                        <div>Records: {symbol.frequency}</div>
                      </div>
                    </Tooltip>
                    <Popup>
                      <div className="p-2 space-y-2">
                        <p className="font-bold text-sm text-[#5A5A40]">{symbol.regionName}</p>
                        <p className="text-xs">Records: {symbol.frequency}</p>
                        <div className="pt-1">
                          {symbol.top3WineTypes.length > 0 ? (
                            symbol.top3WineTypes.map((wt, idx) => (
                              <p key={`${symbol.regionId}-wt-${wt.wine_type}`} className="text-xs">
                                {idx + 1}) {wt.wine_type} ({wt.count})
                              </p>
                            ))
                          ) : (
                            <p className="text-xs italic text-[#A1A19A]">No wine type data</p>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </LayerGroup>

            {/* productionHighlightLayer: hover/click outline only, above circles */}
            <LayerGroup>
              <GeoJSON
                key={`prod-highlight-${activeHighlightRegionId ?? "none"}`}
                data={highlightFeatureCollection}
                pane="production-highlight-pane"
                style={() => ({
                  color: "#8B4513",
                  weight: 2.2,
                  opacity: 0.95,
                  fillOpacity: 0,
                })}
                onEachFeature={(_, layer) => {
                  layer.bringToFront();
                }}
              />
            </LayerGroup>
          </>
        )}

        {viewMode === "consumption" && aggregatedData?.consumption?.map((point, idx) => {
          if (!point.lat || !point.lng) return null;
          return (
            <div key={idx}>
              <Circle
                center={[point.lat, point.lng]}
                radius={Math.sqrt(point.count) * 10000}
                pathOptions={{
                  fillColor: "#8B4513",
                  fillOpacity: 0.3,
                  stroke: false,
                }}
              />
              <Marker position={[point.lat, point.lng]}>
                <Popup>
                  <div className="p-2 space-y-2">
                    <p className="font-bold text-sm text-[#8B4513]">{point.city}</p>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#A1A19A]">Consumption Stats</p>
                    <div className="flex justify-between items-center">
                      <span className="text-xs">Total Drank:</span>
                      <span className="text-xs font-bold">{point.count}</span>
                    </div>
                    <div className="pt-2 border-t border-black/5">
                      <p className="text-[10px] font-bold uppercase text-[#A1A19A] mb-1">Top Brands here:</p>
                      <p className="text-[10px] italic">{point.brands}</p>
                    </div>
                    <div className="pt-1">
                      <p className="text-[10px] font-bold uppercase text-[#A1A19A] mb-1">Origins most enjoyed:</p>
                      <p className="text-[10px] italic">{point.origins}</p>
                    </div>
                  </div>
                </Popup>
              </Marker>
            </div>
          );
        })}
      </MapContainer>

      <div className="absolute top-6 left-6 right-6 z-[1000] space-y-4 pointer-events-none">
        <div className="bg-white/90 backdrop-blur-md p-4 rounded-3xl shadow-xl border border-black/5 pointer-events-auto">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-serif italic text-[#5A5A40]">Wine Hotspots</h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A19A]">
                {viewMode === "consumption" ? "Consumption Intensity Map" : "Regional Production Map"}
              </p>
            </div>
          </div>

          <div className="flex gap-2 p-1 bg-[#F5F5F0] rounded-2xl">
            <button
              onClick={() => setViewMode("consumption")}
              className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "consumption" ? "bg-white text-[#8B4513] shadow-sm" : "text-[#A1A19A]"
              }`}
            >
              Consumption
            </button>
            <button
              onClick={() => setViewMode("production")}
              className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                viewMode === "production" ? "bg-white text-[#5A5A40] shadow-sm" : "text-[#A1A19A]"
              }`}
            >
              Production
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
