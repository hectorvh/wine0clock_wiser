import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getLabelSignedUrl(opts: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(opts.bucket)
    .createSignedUrl(opts.path, opts.expiresInSeconds ?? 60 * 10);

  if (error) {
    console.error("Signed URL error:", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
