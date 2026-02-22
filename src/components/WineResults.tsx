import type { WineCandidate } from "@/lib/wine-api";
import { Wine } from "lucide-react";

interface WineResultsProps {
  candidates: WineCandidate[];
  requestId: string;
}

export function WineResults({ candidates, requestId }: WineResultsProps) {
  if (candidates.length === 0) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <Wine className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No wine labels recognized. Try a clearer photo.</p>
      </div>
    );
  }

  const maxConfidence = candidates[0]?.confidence ?? 1;

  return (
    <div className="glass-card rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
          <Wine className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Recognition Results</h3>
          <p className="text-xs text-muted-foreground">ID: {requestId.slice(0, 8)}…</p>
        </div>
      </div>

      <div className="space-y-3">
        {candidates.map((c, i) => {
          const pct = Math.round(c.confidence * 100);
          const barWidth = (c.confidence / maxConfidence) * 100;
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium text-foreground truncate mr-2">
                  {c.label}
                </span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {pct}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${barWidth}%`,
                    background: `linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
