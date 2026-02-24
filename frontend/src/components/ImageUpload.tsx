import { useCallback, useState } from "react";
import { Upload, Image as ImageIcon } from "lucide-react";

interface ImageUploadProps {
  onFileSelected: (file: File) => void;
}

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024;

export function ImageUpload({ onFileSelected }: ImageUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) return "Only JPG, PNG, and WebP images are allowed.";
    if (file.size > MAX_SIZE) return "File must be under 10MB.";
    return null;
  };

  const handleFile = useCallback(
    (file: File) => {
      const err = validate(file);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`
          flex flex-col items-center justify-center gap-4 p-8 rounded-xl cursor-pointer
          border-2 border-dashed transition-all duration-300
          ${dragOver 
            ? "border-primary bg-primary/10 scale-[1.02]" 
            : "border-border hover:border-primary/50 hover:bg-muted/30"
          }
        `}
      >
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          {dragOver ? (
            <ImageIcon className="h-7 w-7 text-primary" />
          ) : (
            <Upload className="h-7 w-7 text-primary" />
          )}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            Drop your wine label photo here
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            or click to browse · JPG, PNG, WebP · max 10MB
          </p>
        </div>
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>
      {error && (
        <p className="text-sm text-destructive mt-2 text-center">{error}</p>
      )}
    </div>
  );
}
