import { useState } from "react";
import { Bottle } from "../types";
import storage from "../lib/storage";
import { X, MapPin, Calendar, Star, TrendingUp, Trash } from "lucide-react";
import { motion } from "motion/react";

interface BottleDetailProps {
  bottle: Bottle;
  onClose: () => void;
  onUpdate: () => void;
}

export default function BottleDetail({ bottle, onClose, onUpdate }: BottleDetailProps) {
  const [score, setScore] = useState(bottle.score);
  const [notes, setNotes] = useState(bottle.notes);
  const [isSaving, setIsSaving] = useState(false);

  const handleUpdate = async () => {
    setIsSaving(true);
    try {
      const updated = storage.updateBottle(bottle.id, { score, notes });
      if (updated) {
        onUpdate();
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = window.confirm("Delete this log? This action cannot be undone.");
    if (!ok) return;
    try {
      const deleted = await storage.deleteBottle(bottle.id);
      if (deleted) {
        onUpdate();
        onClose();
      } else {
        alert("Failed to delete the log file from the backend.");
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred while deleting.");
    }
  };

  const date = new Date(bottle.timestamp).toLocaleDateString("de-DE", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "100%" }}
      className="fixed inset-0 z-[100] bg-[#F5F5F0] overflow-y-auto pb-32"
    >
      <div className="relative h-72 w-full bg-[#E4E3E0]">
        {bottle.image ? (
          <img src={bottle.image} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#A1A19A]">
            <TrendingUp size={64} />
          </div>
        )}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white"
        >
          <X size={24} />
        </button>
      </div>

      <div className="p-6 -mt-8 relative bg-[#F5F5F0] rounded-t-[32px] space-y-8">
        <section>
          <div className="flex justify-between items-start">
            <h1 className="text-3xl font-serif italic text-[#5A5A40] leading-tight">{bottle.brand}</h1>
            <div className="flex items-center gap-1 bg-white px-3 py-1 rounded-full shadow-sm border border-black/5">
              <Star size={16} className="text-[#D4AF37]" fill="currentColor" />
              <span className="text-sm font-bold">{bottle.score}</span>
            </div>
          </div>
          <p className="text-lg text-[#A1A19A] mt-2">{bottle.producer} · {bottle.year}</p>
        </section>

        <div className="grid grid-cols-2 gap-4">
          <InfoCard icon={<MapPin size={18} />} label="Region" value={bottle.region || "Unknown"} />
          <InfoCard icon={<TrendingUp size={18} />} label="Type" value={bottle.wine_type || "Unknown"} />
          <InfoCard icon={<Calendar size={18} />} label="Logged On" value={date} className="col-span-2" />
        </div>

        <section className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#A1A19A]">Location Metrics</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-[#1A1A1A]">Production Origin</span>
              <span className="text-sm font-semibold text-[#5A5A40]">{bottle.region}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-[#1A1A1A]">Consumption Point</span>
              <span className="text-sm font-semibold text-[#8B4513]">{bottle.city || "Current Location"}</span>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#A1A19A]">Update Rating</h2>
          <div className="flex justify-between gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
              <button
                key={s}
                onClick={() => setScore(s)}
                className={`flex-1 h-10 rounded-lg text-xs font-bold transition-all ${
                  score === s ? "bg-[#5A5A40] text-white scale-110 shadow-md" : "bg-white text-[#A1A19A] border border-black/5"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-[#A1A19A]">Personal Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-white border border-black/5 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 min-h-[120px]"
              placeholder="Add your thoughts..."
            />
          </div>
        </section>

        <div className="flex gap-4 pt-2">
          <button
            onClick={handleUpdate}
            disabled={isSaving}
            className="flex-1 py-4 bg-[#5A5A40] text-white rounded-2xl font-bold text-sm shadow-lg shadow-[#5A5A40]/20 active:scale-95 transition-all disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Update Log"}
          </button>
          <button
            onClick={handleDelete}
            className="w-16 py-4 bg-white border border-black/5 rounded-2xl text-[#A1A19A] hover:text-white hover:bg-red-500 hover:border-red-500 transition-colors flex items-center justify-center"
            title="Delete Log"
          >
            <Trash size={18} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function InfoCard({ icon, label, value, className = "" }: { icon: React.ReactNode; label: string; value: string; className?: string }) {
  return (
    <div className={`bg-white p-4 rounded-2xl border border-black/5 shadow-sm ${className}`}>
      <div className="text-[#A1A19A] mb-1">{icon}</div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#A1A19A]">{label}</p>
      <p className="text-sm font-semibold text-[#1A1A1A]">{value}</p>
    </div>
  );
}
