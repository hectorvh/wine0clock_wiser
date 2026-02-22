import { supabase } from "@/integrations/supabase/client";

export interface WineCandidate {
  label: string;
  confidence: number;
}

export interface RecognitionResult {
  request_id: string;
  top_candidates: WineCandidate[];
  raw_response?: unknown;
}

export async function recognizeWineByFile(
  file: File,
  topK: number = 5,
  includeRaw: boolean = false
): Promise<RecognitionResult> {
  const formData = new FormData();
  formData.append("file", file);

  const { data, error } = await supabase.functions.invoke("recognize-wine", {
    body: formData,
    headers: {
      // Let browser set content-type with boundary for multipart
    },
  });

  if (error) throw new Error(error.message || "Recognition failed");
  if (data?.error) throw new Error(data.error);
  return data as RecognitionResult;
}

export async function recognizeWineByUrl(
  url: string,
  topK: number = 5,
  includeRaw: boolean = false
): Promise<RecognitionResult> {
  const { data, error } = await supabase.functions.invoke("recognize-wine", {
    body: { url },
  });

  if (error) throw new Error(error.message || "Recognition failed");
  if (data?.error) throw new Error(data.error);
  return data as RecognitionResult;
}
