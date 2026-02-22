import { supabase } from "@/integrations/supabase/client";

export interface WineCandidate {
  label: string;
  confidence: number;
}

export interface EnrichmentResult {
  enrichment_status: "matched" | "no_match" | "skipped" | "error";
  explorer?: {
    search_candidates: Array<{ _id: string; name: string }>;
    selected?: { _id: string; name: string; score: number };
    info?: {
      _id?: string;
      name?: string;
      winery?: { name?: string; region?: string };
      statistics?: Record<string, unknown>;
      vintages?: Array<{ year?: number; [key: string]: unknown }>;
      seo_name?: string;
      region?: string;
      characteristics?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
  error_reason?: string;
}

export interface RecognitionResult {
  request_id: string;
  top_candidates: WineCandidate[];
  raw_response?: unknown;
  enrichment?: EnrichmentResult;
}

export async function recognizeWineByFile(
  file: File,
  topK: number = 5,
  includeRaw: boolean = false,
  enrich: boolean = true,
): Promise<RecognitionResult> {
  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams();
  params.set("top_k", String(topK));
  if (includeRaw) params.set("include_raw", "true");
  if (enrich) params.set("enrich", "true");

  const { data, error } = await supabase.functions.invoke(
    `recognize-wine?${params.toString()}`,
    { body: formData },
  );

  if (error) throw new Error(error.message || "Recognition failed");
  if (data?.error) throw new Error(data.error);
  return data as RecognitionResult;
}

export async function recognizeWineByUrl(
  url: string,
  topK: number = 5,
  includeRaw: boolean = false,
  enrich: boolean = true,
): Promise<RecognitionResult> {
  const params = new URLSearchParams();
  params.set("top_k", String(topK));
  if (includeRaw) params.set("include_raw", "true");
  if (enrich) params.set("enrich", "true");

  const { data, error } = await supabase.functions.invoke(
    `recognize-wine?${params.toString()}`,
    { body: { url } },
  );

  if (error) throw new Error(error.message || "Recognition failed");
  if (data?.error) throw new Error(data.error);
  return data as RecognitionResult;
}

export async function searchWineExplorer(wineName: string) {
  const params = new URLSearchParams({ wine_name: wineName });
  const { data, error } = await supabase.functions.invoke(
    `wine-explorer?action=search&${params.toString()}`,
    { method: "GET" as any },
  );
  if (error) throw new Error(error.message);
  return data;
}

export async function getWineExplorerInfo(id: string) {
  const params = new URLSearchParams({ _id: id });
  const { data, error } = await supabase.functions.invoke(
    `wine-explorer?action=info&${params.toString()}`,
    { method: "GET" as any },
  );
  if (error) throw new Error(error.message);
  return data;
}

export async function enrichWine(wineName: string, producer?: string, vintage?: number) {
  const { data, error } = await supabase.functions.invoke("wine-explorer", {
    body: { wine_name: wineName, producer, vintage },
  });
  if (error) throw new Error(error.message);
  return data as EnrichmentResult;
}
