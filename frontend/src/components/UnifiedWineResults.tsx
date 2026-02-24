import type { NormalizedWineResult } from "@/lib/wine-api";
import {
  Wine, MapPin, Thermometer, Clock, DollarSign,
  Grape, Star, AlertCircle, UtensilsCrossed,
} from "lucide-react";

interface UnifiedWineResultsProps {
  result: NormalizedWineResult;
}

export function UnifiedWineResults({ result }: UnifiedWineResultsProps) {
  const { wine, sensory, serving, ratings, debug } = result;

  const hasWineData = wine.full_name || wine.winery;
  const hasErrors = debug.errors.length > 0;

  if (!hasWineData && !hasErrors) {
    return (
      <div className="glass-card rounded-xl p-8 text-center">
        <Wine className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No wine detected. Try a clearer photo.</p>
      </div>
    );
  }

  if (!hasWineData && hasErrors) {
    return (
      <div className="glass-card rounded-xl p-6 text-center space-y-2">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
        <p className="text-sm text-destructive">{debug.errors[0]}</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-6 space-y-5">
      {/* Wine identity */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Wine className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground text-lg leading-tight">
            {wine.full_name}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
            {wine.winery && (
              <span className="text-xs text-muted-foreground">{wine.winery}</span>
            )}
            {wine.vintage && (
              <span className="text-xs font-mono text-accent">{wine.vintage}</span>
            )}
            {wine.wine_type && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wider">
                {wine.wine_type}
              </span>
            )}
          </div>
          {debug.confidence != null && (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden w-32">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(debug.confidence * 100)}%`,
                    background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))",
                  }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                {Math.round(debug.confidence * 100)}% confidence
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3">
        {wine.grape_variety && (
          <InfoCell icon={Grape} label="Grape" value={wine.grape_variety} />
        )}
        {wine.region_name && (
          <InfoCell icon={MapPin} label="Region" value={wine.region_name} />
        )}
        {ratings.avg_rating != null && (
          <InfoCell
            icon={Star}
            label="Rating"
            value={`${Number(ratings.avg_rating).toFixed(1)}${ratings.reviews ? ` (${ratings.reviews})` : ""}`}
          />
        )}
        {wine.average_price_usd != null && (
          <InfoCell icon={DollarSign} label="Avg. Price" value={`$${wine.average_price_usd}`} />
        )}
        {(serving.temp_min_c != null || serving.temp_max_c != null) && (
          <InfoCell
            icon={Thermometer}
            label="Serving"
            value={`${serving.temp_min_c ?? "?"}–${serving.temp_max_c ?? "?"}°C`}
          />
        )}
        {serving.decanting_minutes != null && serving.decanting_minutes > 0 && (
          <InfoCell icon={Clock} label="Decanting" value={`${serving.decanting_minutes} min`} />
        )}
      </div>

      {/* Sensory */}
      {sensory.aroma && (
        <SensorySection title="Aroma" text={sensory.aroma} />
      )}
      {sensory.tasting_notes && (
        <SensorySection title="Tasting Notes" text={sensory.tasting_notes} />
      )}
      {sensory.food_pairing && (
        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Food Pairing</p>
          </div>
          <p className="text-sm text-foreground/80">{sensory.food_pairing}</p>
        </div>
      )}

      {/* Winery description */}
      {wine.winery_description && (
        <div className="border-t border-border/50 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">About the Winery</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{wine.winery_description}</p>
        </div>
      )}

      {/* Errors (non-fatal) */}
      {hasErrors && hasWineData && (
        <div className="flex items-start gap-2 pt-2 border-t border-border/30">
          <AlertCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            {debug.errors.join("; ")}
          </p>
        </div>
      )}

      {/* Mode badge */}
      <div className="flex justify-end">
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-widest">
          {result.mode === "analyzer" ? "Wine Analyzer" : "Recognition + Explorer"}
        </span>
      </div>
    </div>
  );
}

function InfoCell({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}

function SensorySection({ title, text }: { title: string; text: string }) {
  return (
    <div className="border-t border-border/50 pt-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{title}</p>
      <p className="text-sm text-foreground/80 leading-relaxed">{text}</p>
    </div>
  );
}
