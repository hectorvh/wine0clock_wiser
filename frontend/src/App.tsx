import { useEffect, useState } from "react";
import { Home, Camera, Library, Map as MapIcon, Settings } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Dashboard from "./components/Dashboard";
import Scanner from "./components/Scanner";
import BottleList from "./components/BottleList";
import WineMap from "./components/WineMap";
import { Stats } from "./types";
import storage from "./lib/storage";

type Tab = "home" | "scan" | "bottles" | "map";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [stats, setStats] = useState<Stats>({ totalBottles: 0, activeRegions: 0, avgScore: 0 });

  const fetchStats = () => {
    try {
      const data = storage.getStats();
      setStats(data);
    } catch (err) {
      console.error("Failed to fetch stats", err);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    const handler = () => fetchStats();
    window.addEventListener("winetrack:data-changed", handler);
    return () => window.removeEventListener("winetrack:data-changed", handler);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case "home":
        return <Dashboard stats={stats} onNavigate={setActiveTab} />;
      case "scan":
        return <Scanner onComplete={() => { setActiveTab("bottles"); fetchStats(); }} />;
      case "bottles":
        return <BottleList />;
      case "map":
        return <WineMap />;
      default:
        return <Dashboard stats={stats} onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#1A1A1A] font-sans selection:bg-[#5A5A40] selection:text-white">
      <main className="pb-24 max-w-md mx-auto min-h-screen relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-black/5 px-6 py-4 flex justify-between items-center z-[2000] max-w-md mx-auto rounded-t-3xl shadow-2xl">
        <NavButton active={activeTab === "home"} onClick={() => setActiveTab("home")} icon={<Home size={24} />} label="Home" />
        <NavButton active={activeTab === "map"} onClick={() => setActiveTab("map")} icon={<MapIcon size={24} />} label="Map" />
        <div className="relative -top-8 z-[2001]">
          <button
            onClick={() => setActiveTab("scan")}
            className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 ${
              activeTab === "scan"
                ? "bg-[#5A5A40] text-white scale-110 rotate-12"
                : "bg-white text-[#5A5A40] hover:scale-105"
            } border-4 border-[#F5F5F0]`}
          >
            <Camera size={32} />
          </button>
        </div>
        <NavButton active={activeTab === "bottles"} onClick={() => setActiveTab("bottles")} icon={<Library size={24} />} label="Logs" />
        <NavButton active={false} onClick={() => {}} icon={<Settings size={24} />} label="Settings" />
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-colors duration-200 ${
        active ? "text-[#5A5A40]" : "text-[#A1A19A] hover:text-[#5A5A40]"
      }`}
    >
      {icon}
      <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
    </button>
  );
}
