import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, Circle, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import storage from "../lib/storage";
import L from "leaflet";

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

function getProductionMarkerPosition(idx: number, total: number): [number, number] {
  const centerLat = 51.1657;
  const centerLng = 10.4515;
  const angle = (2 * Math.PI * idx) / Math.max(total, 1);
  const radius = 1.2 + (idx % 3) * 0.45;
  return [centerLat + Math.sin(angle) * radius, centerLng + Math.cos(angle) * radius];
}

export default function WineMap() {
  const [aggregatedData, setAggregatedData] = useState<{ production: AggregatedProd[]; consumption: AggregatedPoint[] } | null>(null);
  const [geoData, setGeoData] = useState<GeoJSON.GeoJsonObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"production" | "consumption">("consumption");

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const handler = () => { setLoading(true); fetchData(); };
    window.addEventListener("winetrack:data-changed", handler);
    return () => window.removeEventListener("winetrack:data-changed", handler);
  }, []);

  const fetchData = async () => {
    try {
      await storage.syncBottlesFromFiles();
      const aggData = storage.getAggregatedMap() as { production: AggregatedProd[]; consumption: AggregatedPoint[] };
      const nextGeoData = await storage.fetchRegionsGeoJSON() as GeoJSON.GeoJsonObject;
      setAggregatedData(aggData);
      setGeoData(nextGeoData);
    } catch (err) {
      console.error("Failed to fetch map data", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center text-[#A1A19A] italic">Loading Map...</div>;

  return (
    <div className="h-[calc(100vh-80px)] w-full relative">
      <MapContainer
        center={[51.1657, 10.4515]}
        zoom={6}
        className="h-full w-full"
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
        />

        {viewMode === "production" && geoData && (
          <GeoJSON
            key={JSON.stringify(geoData).length}
            data={geoData}
            style={(feature) => {
              const regionName = feature?.properties?.name as string | undefined;
              const prodData = aggregatedData?.production?.find((p) => p.region === regionName);
              return {
                fillColor: prodData ? "#5A5A40" : "#A1A19A",
                weight: 1,
                opacity: 1,
                color: "white",
                fillOpacity: prodData ? 0.4 : 0.1,
              };
            }}
          />
        )}

        {viewMode === "production" && aggregatedData?.production?.map((prod, idx, arr) => {
          const [lat, lng] = getProductionMarkerPosition(idx, arr.length);
          return (
            <CircleMarker
              key={`${prod.region}-${idx}`}
              center={[lat, lng]}
              radius={Math.max(6, Math.min(22, 6 + prod.count * 1.5))}
              pathOptions={{ color: "#5A5A40", fillColor: "#5A5A40", fillOpacity: 0.45, weight: 1 }}
            >
              <Popup>
                <div className="p-2 space-y-2">
                  <p className="font-bold text-sm text-[#5A5A40]">{prod.region || "Unknown region"}</p>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#A1A19A]">Production Stats</p>
                  <div className="flex justify-between items-center">
                    <span className="text-xs">Bottles Logged:</span>
                    <span className="text-xs font-bold">{prod.count}</span>
                  </div>
                  <div className="pt-2 border-t border-black/5">
                    <p className="text-[10px] font-bold uppercase text-[#A1A19A] mb-1">Brands from here:</p>
                    <p className="text-[10px] italic">{prod.brands || "N/A"}</p>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

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
