import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { type AnalysisMode } from "@/lib/wine-api";

interface AnalysisModeToggleProps {
  mode: AnalysisMode;
  onChange: (mode: AnalysisMode) => void;
}

export function AnalysisModeToggle({ mode, onChange }: AnalysisModeToggleProps) {
  const isAnalyzer = mode === "analyzer";

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-secondary/60 backdrop-blur-sm border border-border/40">
      <Label
        htmlFor="analysis-mode"
        className="text-xs font-medium text-muted-foreground cursor-pointer select-none"
      >
        {isAnalyzer ? "🍷 Analyzer" : "🔍 Recognition + Explorer"}
      </Label>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider hidden sm:inline">
          {isAnalyzer ? "Default" : "Legacy"}
        </span>
        <Switch
          id="analysis-mode"
          checked={!isAnalyzer}
          onCheckedChange={(checked) =>
            onChange(checked ? "recognition_explorer" : "analyzer")
          }
        />
      </div>
    </div>
  );
}
