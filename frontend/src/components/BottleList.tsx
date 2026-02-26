import { useState, useEffect } from "react";
import { Bottle } from "../types";
import storage from "../lib/storage";
import { Search, Calendar, MapPin, Star, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import BottleDetail from "./BottleDetail";

export default function BottleList() {
  const [bottles, setBottles] = useState<Bottle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRegion, setFilterRegion] = useState<string | null>(null);
  const [selectedBottle, setSelectedBottle] = useState<Bottle | null>(null);

  useEffect(() => {
    fetchBottles();
  }, []);

  useEffect(() => {
    const handler = () => fetchBottles();
    window.addEventListener("winetrack:data-changed", handler);
    return () => window.removeEventListener("winetrack:data-changed", handler);
  }, []);

  const fetchBottles = async () => {
    try {
      await storage.syncBottlesFromFiles();
      const data = storage.getAllBottles();
      setBottles(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredBottles = bottles.filter((b) => {
    const matchesSearch = b.brand.toLowerCase().includes(search.toLowerCase())
      || b.producer.toLowerCase().includes(search.toLowerCase());
    const matchesRegion = !filterRegion || b.region === filterRegion;
    return matchesSearch && matchesRegion;
  });

  const regions = Array.from(new Set(bottles.map((b) => b.region).filter(Boolean)));

  if (loading) return <div className="p-6 text-center text-[#A1A19A] italic">Loading your wine cellar...</div>;

  return (
    <div className="p-6 space-y-6">
      <header className="pt-4">
        <h1 className="text-3xl font-serif italic text-[#5A5A40]">My Cellar</h1>
        <p className="text-[#A1A19A] font-medium uppercase tracking-widest text-[10px] mt-1">{bottles.length} Bottles Logged</p>
      </header>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A1A19A]" size={18} />
          <input
            type="text"
            placeholder="Search brand or producer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-black/5 rounded-2xl pl-12 pr-4 py-3 text-sm focus:outline-none shadow-sm"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          <FilterButton
            active={!filterRegion}
            onClick={() => setFilterRegion(null)}
            label="All Regions"
          />
          {regions.map((r) => (
            <FilterButton
              key={r}
              active={filterRegion === r}
              onClick={() => setFilterRegion(r)}
              label={r}
            />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filteredBottles.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-[#A1A19A]/30">
            <p className="text-[#A1A19A] text-sm italic">No bottles found matching your criteria.</p>
          </div>
        ) : (
          filteredBottles.map((bottle) => (
            <BottleCard
              key={bottle.id}
              bottle={bottle}
              onClick={() => setSelectedBottle(bottle)}
            />
          ))
        )}
      </div>

      <AnimatePresence>
        {selectedBottle && (
          <BottleDetail
            bottle={selectedBottle}
            onClose={() => setSelectedBottle(null)}
            onUpdate={fetchBottles}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
        active ? "bg-[#5A5A40] text-white shadow-md" : "bg-white text-[#A1A19A] border border-black/5"
      }`}
    >
      {label}
    </button>
  );
}

function BottleCard({ bottle, onClick }: { bottle: Bottle; onClick: () => void }) {
  const date = new Date(bottle.timestamp).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={onClick}
      className="bg-white rounded-3xl p-4 shadow-sm border border-black/5 flex gap-4 group cursor-pointer active:scale-95 transition-all"
    >
      <div className="w-20 h-24 rounded-2xl bg-[#F5F5F0] overflow-hidden shrink-0">
        {bottle.image ? (
          <img src={bottle.image} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#A1A19A]">
            <MapPin size={24} />
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col justify-between py-1">
        <div>
          <div className="flex justify-between items-start">
            <h3 className="text-sm font-bold text-[#1A1A1A] line-clamp-1">{bottle.brand}</h3>
            <div className="flex items-center gap-1 text-[#D4AF37]">
              <Star size={12} fill="currentColor" />
              <span className="text-xs font-bold">{bottle.score}</span>
            </div>
          </div>
          <p className="text-xs text-[#A1A19A]">{bottle.producer} · {bottle.year}</p>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-[10px] font-bold text-[#A1A19A] uppercase tracking-wider">
              <MapPin size={10} />
              {bottle.region || "Unknown"}
            </div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-[#A1A19A] uppercase tracking-wider">
              <Calendar size={10} />
              {date}
            </div>
          </div>
          <ChevronRight size={16} className="text-[#A1A19A] group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </motion.div>
  );
}
