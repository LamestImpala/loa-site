import { cache } from "react";
import { createServerSupabase, type DbRecord } from "@/lib/supabase";

// Columns the catalog grid needs. Every column named here must be granted to
// anon (see the records_anon_column_grants migrations) or the query fails.
export const LIST_COLUMNS =
  "id, artist, title, pressing, media, sleeve, price, prev_price, notes, photos, photo_urls, discogs_release_id, cover_image, genres, collection, sold, listed, hold_until, created_at, updated_at";

// A record page also shows release details; styles feed "More from the shelves".
export const PAGE_COLUMNS = `${LIST_COLUMNS}, tracklist, country, barcode, styles`;

// Deduped per request, so a record page's generateMetadata and the page
// itself share one query.
export const getListedRecords = cache(async (columns: string = LIST_COLUMNS) => {
  const { data, error } = await createServerSupabase()
    .from("records")
    .select(columns)
    .eq("listed", true)
    .order("artist");
  return { records: (data ?? []) as unknown as DbRecord[], error };
});

export const getRedditPostUrl = cache(async () => {
  const { data } = await createServerSupabase()
    .from("settings")
    .select("value")
    .eq("key", "reddit_post_url")
    .single();
  return (data?.value as string | undefined)?.trim() ?? "";
});
