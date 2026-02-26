import { Stats } from "../types";
import { TrendingUp, MapPin, Star, ChevronRight } from "lucide-react";
import { motion } from "motion/react";

interface DashboardProps {
  stats: Stats;
  onNavigate: (tab: "home" | "scan" | "bottles" | "map") => void;
}

export default function Dashboard({ stats, onNavigate }: DashboardProps) {
  return (
    <div className="p-6 space-y-8">
      <header className="pt-4">
        <h1 className="text-4xl font-serif italic text-[#5A5A40]">WineTrack</h1>
        <p className="text-[#A1A19A] font-medium uppercase tracking-widest text-[10px] mt-1">Your German Wine Journey</p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Bottles Logged"
          value={stats.totalBottles}
          icon={<TrendingUp size={18} />}
          color="bg-[#5A5A40]"
        />
        <StatCard
          label="Regions Explored"
          value={stats.activeRegions}
          icon={<MapPin size={18} />}
          color="bg-[#8B4513]"
        />
        <StatCard
          label="Avg. Taste Score"
          value={stats.avgScore}
          icon={<Star size={18} />}
          color="bg-[#D4AF37]"
          className="col-span-2"
        />
      </div>

      <section className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[#A1A19A]">Quick Actions</h2>
        <div className="space-y-3">
          <ActionButton
            onClick={() => onNavigate("scan")}
            title="Scan New Bottle"
            subtitle="Identify and log a wine label"
            icon={<TrendingUp className="text-[#5A5A40]" />}
          />
          <ActionButton
            onClick={() => onNavigate("map")}
            title="Explore Map"
            subtitle="See consumption hotspots"
            icon={<MapPin className="text-[#8B4513]" />}
          />
        </div>
      </section>

      <section className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-sm font-bold text-[#1A1A1A]">Recent Activity</h2>
          <button onClick={() => onNavigate("bottles")} className="text-xs font-semibold text-[#5A5A40]">View All</button>
        </div>
        <div className="space-y-4">
          {stats.totalBottles === 0 ? (
            <p className="text-center py-8 text-[#A1A19A] text-sm italic">No bottles logged yet. Start scanning!</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#F5F5F0] flex items-center justify-center">
                <TrendingUp size={20} className="text-[#5A5A40]" />
              </div>
              <div>
                <p className="text-sm font-semibold">Latest log recorded</p>
                <p className="text-xs text-[#A1A19A]">Check your logs for details</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon, color, className = "" }: { label: string; value: number | string; icon: React.ReactNode; color: string; className?: string }) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`p-5 rounded-3xl bg-white shadow-sm border border-black/5 flex flex-col justify-between h-32 ${className}`}
    >
      <div className={`w-8 h-8 rounded-full ${color} text-white flex items-center justify-center shadow-inner`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-serif font-bold text-[#1A1A1A]">{value}</p>
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#A1A19A]">{label}</p>
      </div>
    </motion.div>
  );
}

function ActionButton({ onClick, title, subtitle, icon }: { onClick: () => void; title: string; subtitle: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white p-4 rounded-2xl flex items-center justify-between group hover:bg-[#F5F5F0] transition-colors border border-black/5 shadow-sm"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#F5F5F0] group-hover:bg-white flex items-center justify-center transition-colors">
          {icon}
        </div>
        <div className="text-left">
          <p className="text-sm font-bold text-[#1A1A1A]">{title}</p>
          <p className="text-xs text-[#A1A19A]">{subtitle}</p>
        </div>
      </div>
      <ChevronRight size={18} className="text-[#A1A19A]" />
    </button>
  );
}
