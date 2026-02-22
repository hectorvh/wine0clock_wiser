import type { EnrichmentResult } from "@/lib/wine-api";
import { Wine, MapPin, Star, Calendar, Grape, AlertCircle } from "lucide-react";

interface WineEnrichmentProps {
  enrichment: EnrichmentResult;
}

export function WineEnrichment({ enrichment }: WineEnrichmentProps) {
  if (enrichment.enrichment_status === "skipped") {
    return (
      <div className="glass-card rounded-xl p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Confidence too low for enrichment. Try a clearer photo.
        </p>
      </div>
    );
  }

  if (enrichment.enrichment_status === "error") {
    return (
      <div className="glass-card rounded-xl p-4 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
        <p className="text-xs text-muted-foreground">
          Enrichment unavailable: {enrichment.error_reason || "service error"}
        </p>
      </div>
    );
  }

  if (enrichment.enrichment_status === "no_match") {
    return (
      <div className="glass-card rounded-xl p-4 text-center">
        <p className="text-xs text-muted-foreground">
          No detailed wine info found in database.
        </p>
      </div>
    );
  }

  const info = enrichment.explorer?.info;
  const selected = enrichment.explorer?.selected;

  if (!info) {
    return (
      <div className="glass-card rounded-xl p-4">
        <p className="text-sm text-foreground font-medium">
          Matched: {selected?.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Score: {Math.round((selected?.score ?? 0) * 100)}% — detailed info unavailable
        </p>
      </div>
    );
  }

  const winery = info.winery;
  const stats = info.statistics as Record<string, any> | undefined;
  const vintages = info.vintages as Array<{ year?: number }> | undefined;
  const region = info.region || winery?.region;
  const rating = stats?.ratings_average || stats?.average_rating;
  const ratingCount = stats?.ratings_count || stats?.total_ratings;

  return (
    <div className="glass-card rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center">
          <Grape className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground truncate">
            {info.name || selected?.name}
          </h3>
          {winery?.name && (
            <p className="text-xs text-muted-foreground truncate">{winery.name}</p>
          )}
        </div>
        {selected?.score != null && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
            {Math.round(selected.score * 100)}% match
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {region && (
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Region</p>
              <p className="text-sm text-foreground">{region}</p>
            </div>
          </div>
        )}

        {rating != null && (
          <div className="flex items-start gap-2">
            <Star className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Rating</p>
              <p className="text-sm text-foreground">
                {Number(rating).toFixed(1)}
                {ratingCount ? ` (${ratingCount})` : ""}
              </p>
            </div>
          </div>
        )}

        {vintages && vintages.length > 0 && (
          <div className="flex items-start gap-2 col-span-2">
            <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Vintages</p>
              <p className="text-sm text-foreground">
                {vintages
                  .filter((v) => v.year)
                  .map((v) => v.year)
                  .sort((a, b) => (b ?? 0) - (a ?? 0))
                  .slice(0, 8)
                  .join(", ")}
                {vintages.length > 8 ? "…" : ""}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Flavor/characteristics if available */}
      {info.characteristics && Object.keys(info.characteristics).length > 0 && (
        <div className="border-t border-border/50 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Characteristics
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(info.characteristics).slice(0, 8).map(([key, val]) => (
              <span
                key={key}
                className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
              >
                {typeof val === "string" ? val : key}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
