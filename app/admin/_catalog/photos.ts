import type { SupabaseClient } from "@supabase/supabase-js";

// Photos of the actual copy live in the record-photos bucket under the
// item's id. Uploads the files in order and returns their public URLs;
// throws on the first one Storage refuses.
export async function uploadRecordPhotos(
  supabase: SupabaseClient,
  recordId: number,
  files: File[]
): Promise<string[]> {
  const urls: string[] = [];
  for (const file of files) {
    const path = `${recordId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]+/g, "_")}`;
    const { error } = await supabase.storage.from("record-photos").upload(path, file);
    if (error) throw new Error(error.message);
    urls.push(supabase.storage.from("record-photos").getPublicUrl(path).data.publicUrl);
  }
  return urls;
}
