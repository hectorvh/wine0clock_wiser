export interface Bottle {
  id: number;
  image: string;
  brand: string;
  producer: string;
  year: number;
  region: string;
  wine_type: string;
  timestamp: string;
  lat: number;
  lng: number;
  city: string;
  score: number;
  is_german: boolean;
  notes: string;
}

export interface Stats {
  totalBottles: number;
  activeRegions: number;
  avgScore: number;
}

export interface ScanResult {
  brand: string | null;
  producer: string | null;
  year: number | null;
  region: string | null;
  wine_type: string | null;
  is_german: boolean;
  description: string | null;
}
