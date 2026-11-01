import { cache } from "react";
import { createServerSupabase, type DbRecord } from "@/lib/supabase";
import { toReviewQuotes, toReviewSummary } from "@/lib/review";

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

// Seller track record from the shop_stats() function (anon can't see sold
// rows, which are unlisted once they ship). Null when unavailable — the
// shop simply leaves the line out.
export const getShopStats = cache(async () => {
  const { data, error } = await createServerSupabase().rpc("shop_stats").single();
  if (error || !data) return null;
  const row = data as { sold_count: number | string; first_sale: string | null };
  return { soldCount: Number(row.sold_count), firstSale: row.first_sale };
});

// Published shop reviews from shop_review_summary(): the average, the
// count, and up to three quotes. Null when none are published or the call
// fails — the shop leaves the section out.
export const getReviewSummary = cache(async () => {
  const { data, error } = await createServerSupabase().rpc("shop_review_summary");
  if (error) return null;
  return toReviewSummary(data);
});

// Every published review, newest first, for the /reviews page. Empty when
// none are published or the call fails.
export const getPublishedReviews = cache(async () => {
  const { data, error } = await createServerSupabase().rpc("shop_reviews_published");
  if (error) return [];
  return toReviewQuotes(data);
});
